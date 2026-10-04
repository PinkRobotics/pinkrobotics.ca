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
export NODE
export PYTHONDONTWRITEBYTECODE := 1

.PHONY: activity demo activity-test export export-test preview check publiccheck publiccheck-test firstparty seedcheck seedcheck-test livecheck livecheck-test

activity:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) tools/activity/run.py --science "$(SCIENCE)" --era-base "$(ERA_BASE)" --roster "$(ACTIVITY_INPUTS)/lanes.json" --objections "$(ACTIVITY_INPUTS)/objections.json" --ship-feed "$(SHIP_FEED)" $(if $(VERDICTS),--verdicts "$(VERDICTS)",$(if $(filter undefined,$(origin VERDICTS)),--verdicts "fixtures/activity/verdicts.tsv")) --out "$(ACTIVITY_OUT)"

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

seedcheck:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) tools/check_seed.py --check

seedcheck-test:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) -m unittest discover -s tests -p 'test_check_seed.py' -v

export:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) tools/export.py --dest "$(DEST)" --activity "$(ACTIVITY_OUT)/activity.json"

export-test:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) -m unittest discover -s tools -p 'test_export.py' -v

# Not in CHECK_GATES: livecheck needs the network, and make check stays offline.
livecheck:
	@test -n "$(BASE)" || { echo 'livecheck: BASE is required, e.g. make livecheck BASE=https://pinkrobotics.ca' >&2; exit 2; }
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) tools/check_live.py --base "$(BASE)"

livecheck-test:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) -m unittest discover -s tools -p 'test_check_live.py' -v

preview:
	@mkdir -p "$(TMPDIR)"
	$(PYTHON) tools/preview.py --dest "$(TMPDIR)/preview" --activity "$(ACTIVITY_OUT)/activity.json"

# One gate inventory drives both execution and help. Keep going reports every failure.
CHECK_GATES := activity-test fixturecheck publiccheck publiccheck-test seedcheck seedcheck-test livecheck-test firstparty labelcheck labelcheck-test export export-test control-test
.NOTPARALLEL:
.PHONY: help fixturecheck control-test
help:
	@echo 'make check: $(CHECK_GATES)'
	@echo 'make livecheck BASE=<address>: proves what serves equals the recorded seed, or names the difference and the network additions; needs the network, never in make check'
	@echo 'each offline gate: its evidence and limit are tabulated in README.md'

check:
	@command -v "$(NODE)" >/dev/null 2>&1 || { echo 'check: node not found; run with NODE=/absolute/path/to/node' >&2; exit 2; }
	$(MAKE) --keep-going $(CHECK_GATES)

fixturecheck: demo
	$(PYTHON) tools/activity/boundary.py fixtures/activity/lanes.json
	$(PYTHON) tools/activity/boundary.py fixtures/activity/objections.json
	$(PYTHON) tools/activity/boundary.py "$(ACTIVITY_OUT)/activity.json"

control-test:
	$(NODE) --test site/airship3d/tests/control.test.mjs

.PHONY: labelcheck labelcheck-test
labelcheck:
	$(PYTHON) tools/check_labels.py

labelcheck-test:
	$(PYTHON) -m unittest discover -s tests -p 'test_check_labels.py' -v
