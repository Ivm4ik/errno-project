.PHONY: demo api web test

# Backend tests. Create the venv first: cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt
test:
	cd backend && .venv/bin/pytest -q

api:
	cd backend && .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000

web:
	cd vita-astronaut-health-monitor/frontend && npm run dev -- --port 3000

# API on :8000 and the site on :3000. The sensor generator is inside the site (button in the corner).
demo:
	( cd backend && .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8000 ) & \
	( cd vita-astronaut-health-monitor/frontend && npm run dev -- --port 3000 ) & \
	wait
