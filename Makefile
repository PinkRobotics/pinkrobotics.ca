PYTHON ?= python3
NODE ?= node
TMPDIR ?= $(CURDIR)/.scratch
SCIENCE ?= fixture
ERA_BASE ?=
ACTIVITY_INPUTS ?= fixtures/activity
SHIP_FEED ?= none
DEST ?= $(TMPDIR)/export
ACTIVITY_OUT ?= $(TMPDIR)/activity

export TMPDIR
export PYTHONDONTWRITEBYTECODE := 1

.PHONY: activity demo activity-test export export-test preview check publiccheck publiccheck-test firstparty

activity:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) tools/activity/run.py --science "$(SCIENCE)" --era-base "$(ERA_BASE)" --roster "$(ACTIVITY_INPUTS)/lanes.json" --objections "$(ACTIVITY_INPUTS)/objections.json" --ship-feed "$(SHIP_FEED)" --out "$(ACTIVITY_OUT)"

demo: activity

activity-test:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) -m unittest discover -s tools/activity -p 'test_*.py' -v

publiccheck:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) tools/check_public.py --include-untracked

publiccheck-test:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) -m unittest discover -s tests -p 'test_check_public.py' -v

firstparty:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) -m unittest discover -s tools -p 'test_first_party.py' -v
	$(PYTHON) tools/check_first_party.py

export:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) tools/export.py --dest "$(DEST)" --activity "$(ACTIVITY_OUT)/activity.json"

export-test:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) -m unittest discover -s tools -p 'test_export.py' -v

preview:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) tools/preview.py --dest "$(TMPDIR)/preview" --activity "$(ACTIVITY_OUT)/activity.json"

check:
	$(MAKE) activity-test
	$(PYTHON) tools/activity/boundary.py fixtures/activity/lanes.json
	$(PYTHON) tools/activity/boundary.py fixtures/activity/objections.json
	$(MAKE) demo
	$(PYTHON) tools/activity/boundary.py "$(ACTIVITY_OUT)/activity.json"
	$(MAKE) export-test
	$(NODE) --test site/airship3d/tests/control.test.mjs
