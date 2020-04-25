package main

import (
	"fmt"
	"github.com/go-git/go-billy/v5/memfs"
	"github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/config"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
	"github.com/go-git/go-git/v5/storage/memory"
	"github.com/pkg/errors"
	"gopkg.in/yaml.v2"
	"log"
	"net/http"
	"os"
	"strings"
	"time"
)

func main() {
	http.HandleFunc("/", indexHandler)
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
		log.Printf("Defaulting to port %s", port)
	}

	log.Printf("Listening on port %s", port)
	log.Printf("Open http://localhost:%s in the browser", port)
	log.Fatal(http.ListenAndServe(fmt.Sprintf(":%s", port), nil))
}

func indexHandler(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	if r.URL.Query().Get("secret") != os.Getenv("SECRET") {
		w.WriteHeader(http.StatusForbidden)
		return
	}

	err := run(w)
	if err != nil {
		log.Printf("ioio %v", err)
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	
	w.WriteHeader(http.StatusOK)
}

func run(w http.ResponseWriter) error {
	queryRsp := &PRsRsp{}
	err := call(prsQuery(), queryRsp)
	if err != nil {
		return err
	}

	jobs := handleMergedPRs(queryRsp)

	storage := memory.NewStorage()
	fs := memfs.New()
	repo, err := git.Clone(storage, fs, &git.CloneOptions{
		URL: "https://github.com/kyma-project/kyma",
	})
	if err != nil {
		return err
	}



	remote, err := repo.CreateRemote(&config.RemoteConfig{
		Name: "fork",
		URLs: []string{fmt.Sprintf("https://%s@github.com/%s/kyma", token, queryRsp.Data.Viewer.Login)},
	})
	if err != nil {
		return  errors.Wrap(err, "create remote")
	}

	branchName := fmt.Sprintf("bump-conosle-%s", today)
	branchRef := plumbing.ReferenceName("refs/heads/" + branchName)

	err = repo.CreateBranch(&config.Branch{
		Name:   branchName,
		Merge:  branchRef,
		Remote: "fork",
	})
	if err != nil {
		return  errors.Wrap(err, "create branch")
	}

	wt, err := repo.Worktree()
	if err != nil {
		return err
	}

	err = wt.Checkout(&git.CheckoutOptions{
		Branch: branchRef,
		Create: true,
	})
	if err != nil {
		return errors.Wrap(err, "checkout")
	}

	for job, data := range jobs {
		cfg, ok := jobsConfig[job]
		if !ok {
			continue
		}

		for _, prop := range cfg.props {
			f, err := fs.OpenFile(prop.valuesPath, os.O_RDWR, 0)
			if err != nil {
				return err
			}
			defer f.Close()

			values := make(map[interface{}]interface{})
			err = yaml.NewDecoder(f).Decode(values)
			if err != nil {
				return  errors.Wrapf(err, "decode %s", prop.valuesPath)
			}

			err = f.Truncate(0)
			if err != nil {
				return  errors.Wrap(err, "truncate")
			}

			_, err = f.Seek(0, 0)
			if err != nil {
				return  errors.Wrap(err, "seek")
			}

			deepReplace(values, strings.Split(prop.imageProp, "."), data.OID)
			bs, err := yaml.Marshal(values)
			if err != nil {
				return err
			}

			_, err = f.Write(bs)
			if err != nil {
				return err
			}
		}
	}

	_, err = wt.Commit(fmt.Sprintf("Bump console images %s", today), &git.CommitOptions{
		All: true,
		Author: &object.Signature{
			Name:  queryRsp.Data.Viewer.Name,
			Email: queryRsp.Data.Viewer.Email,
			When:  time.Now(),
		},
	})
	if err != nil {
		return err
	}

	err = remote.Push(&git.PushOptions{RemoteName: "fork", RefSpecs: []config.RefSpec{config.RefSpec("refs/heads/" + branchName + ":refs/heads/" + branchName)}})
	if err != nil {
		return errors.Wrap(err, "push")
	}

	return err
}
type CommitData struct {
	OID string
	Date time.Time
}
type JobsCommits map[string]CommitData

func (jc JobsCommits) hasJob(name string) bool {
	_, ok := jc[name]
	return ok
}

func handleMergedPRs(data *PRsRsp) JobsCommits {
	result := JobsCommits{}

	for _, node := range data.Data.Search.Nodes {
		status := node.MergeCommit.Status
		commitData := CommitData{OID: node.MergeCommit.OID[0:8], Date: node.MergeCommit.CommittedDate}
		if status != nil {
			for _, context := range status.Contexts {
				if !result.hasJob(context.Context) || commitData.Date.After(result[context.Context].Date) {
					result[context.Context] = commitData
				}
			}
		}
	}

	return result
}

func deepReplace(doc map[interface{}]interface{}, path []string, value interface{}) {
	if len(path) == 1 {
		doc[path[0]] = value
		return
	}

	nested := doc[path[0]]
	deepReplace(nested.(map[interface{}]interface{}), path[1:], value)
}