.PHONY: ciam-up ciam-down ciam-logs

ciam-up:
	cd ciam && docker compose up -d --build

ciam-down:
	cd ciam && docker compose down -v

ciam-logs:
	cd ciam && docker compose logs -f --tail=200
