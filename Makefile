PYTHON ?= python3
# Override these paths when building from a different checkout or archived inputs.
SCIENCE ?= $(HOME)/dev/airships
ACTIVITY_INPUTS ?= $(HOME)/data/pinkrobotics/activity
ERA_BASE ?= 09b9c0e2901f624f063a00043da75480cd63129e
SHIP_FEED ?= https://pinkai.ca/bridge/work-targets.json
export TMPDIR := $(HOME)/data/pinkrobotics/tmp/activity
export PYTHONDONTWRITEBYTECODE := 1

.PHONY: activity activity-test
activity:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) tools/activity/build.py --science "$(SCIENCE)" --era-base "$(ERA_BASE)" --roster "$(ACTIVITY_INPUTS)/lanes.json" --objections "$(ACTIVITY_INPUTS)/objections.json" --ship-feed "$(SHIP_FEED)" --out site/log/data

activity-test:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) -m unittest discover -s tools/activity -p 'test_*.py' -v
