package main

import (
	"os"
	"time"
)

var today = time.Now().Format("2006-01-02")
var token = os.Getenv("TOKEN")
var gitHubApiUrl = "https://api.github.com/graphql"

type Prop struct {
	valuesPath string
	imageProp  string
}

type Job struct {
	imageName string
	props     []Prop
}

var jobsConfig = map[string]Job{
	"post-master-console-compass": {
		props: []Prop{{
			valuesPath: "resources/compass/charts/cockpit/values.yaml",
			imageProp:  "images.ui.version",
		}, {
			valuesPath: "resources/core/charts/console/values.yaml",
			imageProp:  "compass_mfs.image.tag",
		}},
	},
	"post-master-console-core-ui": {
		props: []Prop{{
			valuesPath: "resources/core/charts/console/values.yaml",
			imageProp:  "core_ui.image.tag",
		}},
	},
	"post-master-console-core": {
		props: []Prop{{
			valuesPath: "resources/core/charts/console/values.yaml",
			imageProp:  "console.image.tag",
		}},
	},
}
