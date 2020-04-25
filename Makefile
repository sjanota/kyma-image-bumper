generate-app:
	envsubst <app.tpl.yaml >app.yaml
generate-cron:
	envsubst <cron.tpl.yaml >cron.yaml

deploy: generate-app
	gcloud app deploy
deploy-cron: generate-cron
	gcloud app deploy cron.yaml