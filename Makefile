PYTHON ?= python3
# Supply paths to the companion science checkout and reviewed activity inputs.
SCIENCE ?= ../airships
ACTIVITY_INPUTS ?= .local/activity
ERA_BASE ?= 09b9c0e2901f624f063a00043da75480cd63129e
SHIP_FEED ?= https://pinkai.ca/bridge/work-targets.json
TMPDIR ?= .local/tmp
export TMPDIR
export PYTHONDONTWRITEBYTECODE := 1

.PHONY: activity activity-test publiccheck publiccheck-test
activity:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) tools/activity/build.py --science "$(SCIENCE)" --era-base "$(ERA_BASE)" --roster "$(ACTIVITY_INPUTS)/lanes.json" --objections "$(ACTIVITY_INPUTS)/objections.json" --ship-feed "$(SHIP_FEED)" --out site/log/data

activity-test:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) -m unittest discover -s tools/activity -p 'test_*.py' -v

publiccheck:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) tools/check_public.py --include-untracked

publiccheck-test:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) -m unittest discover -s tests -p 'test_check_public.py' -v
