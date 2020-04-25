build:
	go build -o ./bumper ./

build-image:
	docker build -t sjanota/bumper:latest .

push-image:
	docker push sjanota/bumper

generate-app:
	envsubst <app.ypl.yaml >app.yaml