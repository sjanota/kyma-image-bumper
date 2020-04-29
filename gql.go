package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"time"
)

func prsQuery(since string) string {
	return fmt.Sprintf(`
query {
    viewer {
        login
		email
		name
    }
    search(type: ISSUE, first: 100, query: "repo:kyma-project/console is:pr merged:>=%s") {
      nodes {
        ... on PullRequest {
          title
		  number
		  author {
            login
		  }
          mergeCommit {
            oid
            committedDate
            status {
              contexts {
                context
                description
              }
            }
          }
        }
      }
    }
    repository(owner: "kyma-project", name: "kyma") {
        id
    }
}
`, since)
}

type PRsRsp struct {
	Errors interface{} `json:"errors"`
	Data   struct {
		Viewer struct {
			Login string `json:"login"`
			Email string `json:"email"`
			Name  string `json:"name"`
		} `json:"viewer"`
		Repository struct {
			ID string `json:"id"`
		} `json:"repository"`
		Search struct {
			Nodes []struct {
				Title  string `json:"title"`
				Number int    `json:"number"`
				Author struct {
					Login string `json:"login"`
				} `json:"author"`
				MergeCommit struct {
					OID           string    `json:"oid"`
					CommittedDate time.Time `json:"committedDate"`
					Status        *struct {
						Contexts []struct {
							Context string `json:"context"`
						} `json:"contexts"`
					} `json:"status"`
				} `json:"mergeCommit"`
			} `json:"nodes"`
		} `json:"search"`
	} `json:"data"`
}

func createPRMutation(repoID, forkOwner, body, since string) string {
	return fmt.Sprintf(`
mutation { 
    createPullRequest(input: {
      repositoryId: %q,
      baseRefName: "master",
      headRefName: "%s:bump-console-%s"
      title: "Bump console images on %s",
	  body: "%s"
    }) { 
      pullRequest {
        url
      }
    }
}
`, repoID, forkOwner, since, since, body)
}

func call(query string, decodeInto interface{}) error {
	body, err := json.Marshal(&struct {
		Query string `json:"query"`
	}{query})
	if err != nil {
		return err
	}

	post, err := http.NewRequest(http.MethodPost, gitHubApiUrl, bytes.NewReader(body))
	if err != nil {
		return err
	}
	post.Header.Add("authorization", fmt.Sprintf("bearer %s", token))

	rsp, err := http.DefaultClient.Do(post)
	if err != nil {
		return err
	}
	defer rsp.Body.Close()

	if rsp.StatusCode != http.StatusOK {
		return fmt.Errorf("unexpected status code %v", rsp.StatusCode)
	}
	body, err = ioutil.ReadAll(rsp.Body)
	if err != nil {
		return err
	}

	//log.Println(string(body))
	return json.Unmarshal(body, decodeInto)
}
