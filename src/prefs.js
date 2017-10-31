"use strict";

const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Gettext = imports.gettext.domain("gsconnect");
const _ = Gettext.gettext;
const Gio = imports.gi.Gio;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;

// Local Imports
function getPath() {
    // Diced from: https://github.com/optimisme/gjs-examples/
    let m = new RegExp("@(.+):\\d+").exec((new Error()).stack.split("\n")[1]);
    return Gio.File.new_for_path(m[1]).get_parent().get_path();
}

imports.searchPath.push(getPath());

const Client = imports.client;
const Common = imports.common;
const DeviceWidget = imports.widgets.device;
const KeybindingsWidget = imports.widgets.keybindings;
const PreferencesWidget = imports.widgets.preferences;


/** A GtkStack subclass with a pre-attached GtkStackSwitcher */
var PrefsWidget = new Lang.Class({
    Name: "PrefsWidget",
    Extends: PreferencesWidget.Stack,
    
    _init: function () {
        this.parent();
        
        this.daemon = new Client.Daemon();
        
        this._build();
        
        this._watchdog = Gio.bus_watch_name(
            Gio.BusType.SESSION,
            Client.BUS_NAME,
            Gio.BusNameWatcherFlags.NONE,
            Lang.bind(this, this._serviceAppeared),
            Lang.bind(this, this._serviceVanished)
        );
    },
    
    _serviceAppeared: function (conn, name, name_owner, cb_data) {
        Common.debug("PrefsWidget._serviceAppeared()");
        
        if (!this.daemon) {
            this.daemon = new Client.Daemon();
        }
        
        this.daemon.discovering = true;
        
        for (let dbusPath of this.daemon.devices.keys()) {
            this.devicesStack.addDevice(this.daemon, dbusPath);
        }
        
        // Watch for new and removed devices
        this.daemon.connect(
            "device::added",
            Lang.bind(this.devicesStack, this.devicesStack.addDevice)
        );
        
        this.daemon.connect(
            "device::removed",
            Lang.bind(this.devicesStack, this.devicesStack.removeDevice)
        );
    },
    
    _serviceVanished: function (conn, name, name_owner, cb_data) {
        Common.debug("PrefsWidget._serviceVanished()");
        
        if (this.daemon) {
            this.daemon.destroy();
            this.daemon = false;
        }
        
        if (!Common.Settings.get_boolean("debug")) {
            this.daemon = new Client.Daemon();
        }
    },
    
    _build: function () {
        // General Page
        let generalPage = this.addPage("general", _("General"));
        
        let appearanceSection = generalPage.addSection(_("Appearance"));
        appearanceSection.addGSetting(Common.Settings, "show-indicators");
        appearanceSection.addGSetting(Common.Settings, "show-offline");
        appearanceSection.addGSetting(Common.Settings, "show-unpaired");
        
        let filesSection = generalPage.addSection(
            _("Files"),
            null,
            { margin_bottom: 0 }
        );
        filesSection.addGSetting(Common.Settings, "nautilus-integration");
        
        // Devices Page
        this.devicesStack = new DeviceWidget.Stack(this);
        let devicesPage = this.add_titled(
            this.devicesStack,
            "devices", 
            _("Devices")
        );
        
        // About/Advanced
        let advancedPage = this.addPage("advanced", _("Advanced"));
        let develSection = advancedPage.addSection(
            _("Development"),
            null,
            { margin_bottom: 32 }
        );
        develSection.addGSetting(Common.Settings, "debug");
        Common.Settings.connect("changed::debug", () => {
            if (Common.Settings.get_boolean("debug")) {
                this.daemon.quit();
            }
        });
    }
});


function init() {
    Common.debug("initializing extension preferences");
    
    Common.initConfiguration();
}

// Extension Preferences
function buildPrefsWidget() {
    Common.debug("Prefs: buildPrefsWidget()");
    
    let prefsWidget = new PrefsWidget();
    
    Mainloop.timeout_add(0, () => {
        let prefsWindow = prefsWidget.get_toplevel()
        prefsWindow.get_titlebar().custom_title = prefsWidget.switcher;
        prefsWindow.connect("destroy", () => {
            prefsWidget.daemon.discovering = false;
        });
        return false;
    });
    
    prefsWidget.show_all();
    return prefsWidget;
}

