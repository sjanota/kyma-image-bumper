const axios = require("axios");

const query = `
query {
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
  }
`;

const githubUrl = "https://api.github.com/graphql";

const imagePrefix = "eu.gcr.io/kyma-project";
const imageNameDict = {
  compass: "compass-ui",
  "core-ui": "core-ui",
};

axios
  .post(
    githubUrl,
    { query },
    {
      headers: {
        authorization: "bearer ",
      },
    }
  )
  .then((rsp) => {
    const jobsCommits = {};
    rsp.data.data.search.nodes.forEach((pr) => {
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
      bumps[component] = `eu.gcr.io/kyma-project/${
        imageNameDict[component]
      }:${commitData.oid.substring(0, 8)}`;
    });
    console.log(bumps);
  })
  .catch((err) => console.log(err));
