.PHONY: dev build up down migrate seed

dev:
	pnpm dev

build:
	pnpm build

up:
	docker compose up --build

down:
	docker compose down -v

migrate:
	pnpm db:migrate

seed:
	pnpm db:seed
