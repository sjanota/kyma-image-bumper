const axios = require("axios");
const cmd = require("node-cmd");
const mktemp = require("mktemp");
const Promise = require("bluebird");
const yaml = require("js-yaml");
fs = require("fs");

const cmdGet = Promise.promisify(cmd.get, { multiArgs: true, context: cmd });

const headers = {
  authorization: `bearer ${process.env.TOKEN}`,
};
const githubUrl = "https://api.github.com/graphql";
const today = new Date().toLocaleDateString();
console.log(today);
const query = `
query {
    viewer {
        login
    }
    search(type: ISSUE, first: 100, query: "repo:kyma-project/console is:pr merged:>=2020-04-23") {
      nodes {
        ... on PullRequest {
          title
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
`;

const createPR = (repoID, forkOwner) => `
mutation { 
    createPullRequest(input: {
      repositoryId: "${repoID}",
      baseRefName: "master",
      headRefName: "${forkOwner}:bump-2020-04-23"
      title: "Bump console images on 2020-04-23"
    }) { 
      pullRequest {
        url
      }
    }
}
`;

const imageNameDict = {
  compass: {
    imageName: "compass-ui",
    imageFile: "compass/charts/cockpit/values.yaml",
    imagePropPath: "images.ui.version",
  },
  "core-ui": {
    imageName: "core-ui",
    imageFile: "core/charts/console/values.yaml",
    imagePropPath: "console.image.tag",
  },
};

function deepReplace(obj, path, value) {
  var paths = path.split("."),
    current = obj,
    i;

  for (i = 0; i < paths.length - 1; ++i) {
    if (current[paths[i]] == undefined) {
      return undefined;
    } else {
      current = current[paths[i]];
    }
  }
  current[paths[paths.length - 1]] = value;
}

function handleMergedPRs({ data }) {
  const jobsCommits = {};
  data.search.nodes.forEach((pr) => {
    const status = pr.mergeCommit.status;
    const commitData = {
      oid: pr.mergeCommit.oid,
      date: pr.mergeCommit.committedDate,
    };
    if (!!status) {
      status.contexts.forEach((ctx) => {
        if (
          !jobsCommits[ctx.context] ||
          Date.parse(commitData.date) >
            Date.parse(jobsCommits[ctx.context].date)
        ) {
          jobsCommits[ctx.context] = commitData;
        }
      });
    }
  });
  const bumps = {};
  Object.entries(jobsCommits).forEach(([jobName, commitData]) => {
    const component = jobName.replace("post-master-console-", "");
    bumps[component] = commitData.oid.substring(0, 8);
  });
  return bumps;
}

function callGitHub(query) {
  return axios.post(githubUrl, { query }, { headers });
}

callGitHub(query)
  .then(async (rsp) => {
    const bumps = handleMergedPRs(rsp.data);
    const repoID = rsp.data.data.repository.id;
    const forkOwner = rsp.data.data.viewer.login;
    const path = await mktemp.createDir("/tmp/kyma-XXXXXX");
    console.log(bumps, path);
    await cmdGet(`
        git clone https://github.com/kyma-project/kyma ${path}
        cd ${path}
        git remote set-url origin https://github.com/${forkOwner}/kyma
    `);
    Object.entries(bumps).forEach(async ([component, image]) => {
      const valuesFile = `${path}/resources/${imageNameDict[component].imageFile}`;
      const doc = yaml.safeLoad(fs.readFileSync(valuesFile, "utf8"));
      deepReplace(doc, imageNameDict[component].imagePropPath, image);
      fs.writeFileSync(valuesFile, yaml.safeDump(doc));
    });
    await cmdGet(`
        cd ${path}
        git checkout -b bump-2020-04-23
        git commit -a -m "Bump images"
        git push origin bump-2020-04-23
    `);
    const query = createPR(repoID, forkOwner);
    // const createRsp = await callGitHub(query);
    // if (!!createRsp.data.errors) {
    //   console.log(createRsp.data);
    // }
  })
  .catch((err) => console.log(err));
