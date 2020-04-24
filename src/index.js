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
const today = new Date().toISOString().replace(/T.*$/, "");

const query = `
query {
    viewer {
        login
    }
    search(type: ISSUE, first: 100, query: "repo:kyma-project/console is:pr merged:>=${today}") {
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
      headRefName: "${forkOwner}:bump-${today}"
      title: "Bump console images on ${today}"
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

async function run() {
  const rsp = await callGitHub(query);
  if (!!rsp.data.errors) {
    console.log(createRsp.data);
  }
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
        git checkout -b bump-${today}
        git commit -a -m "Bump images"
        git push origin bump-${today}
        cd ..
        rm -rf ${path}
    `);
  const query = createPR(repoID, forkOwner);
  //   const createRsp = await callGitHub(query);
  //   if (!!createRsp.data.errors) {
  //     console.log(createRsp.data);
  //   }
  return query;
}

const express = require("express");

const app = express();

app.get("/", async (req, res) => {
  const mutation = await run();
  res.status(200).send(mutation).end();
});

// Start the server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`App listening on port ${PORT}`);
  console.log("Press Ctrl+C to quit.");
});
// [END gae_node_request_example]

module.exports = app;
