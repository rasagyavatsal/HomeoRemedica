# Everyday commands for the Android app. `make` lists them.
#
# The app installs on whichever device adb sees: a phone, a local emulator, or an emulator on another
# machine. For a remote emulator, set EMULATOR_HOST to its SSH address in local.mk (not committed):
#
#     EMULATOR_HOST = user@192.168.1.20
#
# That machine runs the emulator with its adb port on 5555 (see "Remote emulator" in README.md). `make
# connect` tunnels this machine's port $(ADB_PORT) to it over SSH, and tunnels the emulator machine's port
# $(API_PORT) back here, so 10.0.2.2:$(API_PORT) in the emulator reaches `npm start` on this machine.

-include local.mk

EMULATOR_HOST ?=
EMULATOR_SERVICE ?= android-emulator
ADB_PORT ?= 15555
API_PORT ?= 8000

APP_ID := com.rasagyavatsal.homeoremedica
LAUNCH := $(APP_ID)/io.github.rasagyavatsal.homeoremedica.MainActivity
GRADLE := ./gradlew

ifneq ($(strip $(EMULATOR_HOST)),)
SERIAL := 127.0.0.1:$(ADB_PORT)
export ANDROID_SERIAL := $(SERIAL)
TUNNEL := $(HOME)/.ssh/homeoremedica-emulator-$(ADB_PORT).sock
endif

ADB := adb $(if $(SERIAL),-s $(SERIAL))

.DEFAULT_GOAL := help
.PHONY: help connect disconnect emu install run local restart logs shot test

help:
	@echo "make emu         connect and open the emulator's screen in a window"
	@echo "make connect     connect adb to the device without a window"
	@echo "make disconnect  close the tunnel to the remote emulator"
	@echo "make install     build the debug app and install it"
	@echo "make run         install and open the app"
	@echo "make local       install and open a build that uses npm start on this machine"
	@echo "make restart     restart the remote emulator"
	@echo "make logs        follow the app's log"
	@echo "make shot        save a screenshot to build/screenshots/"
	@echo "make test        run the unit tests"
	@echo
	@echo "Device: $(if $(SERIAL),remote emulator on $(EMULATOR_HOST),the one adb sees)"

connect:
ifneq ($(strip $(EMULATOR_HOST)),)
	@ssh -S "$(TUNNEL)" -O check $(EMULATOR_HOST) 2>/dev/null || \
	  ssh -f -N -M -S "$(TUNNEL)" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
	    -L $(ADB_PORT):127.0.0.1:5555 -R $(API_PORT):127.0.0.1:$(API_PORT) $(EMULATOR_HOST)
	@adb connect $(SERIAL) >/dev/null
endif
	@printf 'Waiting for the device to finish booting'; tries=0; \
	until [ "$$($(ADB) shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = 1 ]; do \
	  tries=$$((tries + 1)); \
	  if [ $$tries -ge 15 ] && adb devices | grep -q 'unauthorized'; then \
	    echo; echo "The device rejected this machine's adb key. A remote emulator trusts the key in" >&2; \
	    echo "~/.android/adbkey on the machine that runs it, so that key must match this machine's." >&2; \
	    exit 1; \
	  fi; \
	  if [ $$tries -ge 150 ]; then echo; echo "No device finished booting in 5 minutes." >&2; exit 1; fi; \
	  printf '.'; sleep 2; \
	  $(if $(SERIAL),adb connect $(SERIAL) >/dev/null 2>&1 || true;) \
	done; echo " ready"

disconnect:
ifneq ($(strip $(EMULATOR_HOST)),)
	@adb disconnect $(SERIAL) >/dev/null 2>&1 || true
	@ssh -S "$(TUNNEL)" -O exit $(EMULATOR_HOST) 2>/dev/null || true
	@echo "Disconnected from $(EMULATOR_HOST)."
else
	@echo "EMULATOR_HOST isn't set, so there's no tunnel to close."
endif

# --force-adb-forward: scrcpy's default reverse connection fails when adb runs through an SSH tunnel.
emu: connect
	scrcpy $(if $(SERIAL),-s $(SERIAL)) --force-adb-forward --window-title "HomeoRemedica emulator" \
	  --stay-awake --max-fps 60

install: connect
	$(GRADLE) installDebug

run: install
	$(ADB) shell am start -W -n $(LAUNCH) >/dev/null

local: connect
	$(GRADLE) installDebug -Phomeoremedica.apiBaseUrl=http://10.0.2.2:$(API_PORT)
	$(ADB) shell am start -W -n $(LAUNCH) >/dev/null
	@echo "The app now uses http://10.0.2.2:$(API_PORT); start the server with npm start in the repository root."

restart:
ifneq ($(strip $(EMULATOR_HOST)),)
	ssh $(EMULATOR_HOST) 'systemctl --user restart $(EMULATOR_SERVICE)'
	@echo "Restarting; run make connect to wait for it."
else
	@echo "EMULATOR_HOST isn't set; restart your local emulator or device yourself." >&2; exit 1
endif

logs: connect
	@pid=$$($(ADB) shell pidof $(APP_ID) | tr -d '\r'); \
	if [ -z "$$pid" ]; then echo "The app isn't running; start it with make run." >&2; exit 1; fi; \
	$(ADB) logcat -v color --pid=$$pid

shot: connect
	@mkdir -p build/screenshots; f=build/screenshots/$$(date +%Y%m%d-%H%M%S).png; \
	$(ADB) exec-out screencap -p > $$f && echo "Saved $$f"

test:
	$(GRADLE) testDebugUnitTest
