build:
	go build -o ./bumper ./

build-image:
	docker build -t sjanota/bumper:latest .

push-image:
	docker push sjanota/bumper

generate-app:
	envsubst <app.tpl.yaml >app.yaml

deploy: generate-app
	gcloud app deploy