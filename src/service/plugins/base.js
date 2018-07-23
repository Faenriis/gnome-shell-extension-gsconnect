'use strict';

const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;

// Local Imports
const Device = imports.service.device;


/**
 * Base class for plugins
 */
var Plugin = GObject.registerClass({
    GTypeName: 'GSConnectPlugin',
    Signals: {
        'destroy': {
            flags: GObject.SignalFlags.NO_HOOKS
        }
    }
}, class Plugin extends GObject.Object {

    _init(device, name) {
        super._init();

        this.service = Gio.Application.get_default();

        this._device = device;
        this._name = name;
        this._meta = imports.service.plugins[name].Metadata;

        // Init GSettings
        this.settings = new Gio.Settings({
            settings_schema: gsconnect.gschema.lookup(this._meta.id, -1),
            path: `${gsconnect.settings.path}device/${device.id}/plugin/${name}/`
        });

        // GActions
        this._gactions = [];

        if (this._meta.actions) {
            // Register based on device capabilities, which shouldn't change
            let deviceHandles = this.device.settings.get_strv('incoming-capabilities');
            let deviceProvides = this.device.settings.get_strv('outgoing-capabilities');
            let blacklist = this.device.settings.get_strv('action-blacklist');

            for (let name in this._meta.actions) {
                let meta = this._meta.actions[name];

                if (meta.incoming.every(p => deviceProvides.includes(p)) &&
                    meta.outgoing.every(p => deviceHandles.includes(p))) {
                    this._registerAction(name, meta, blacklist);
                }
            }

            // We enabled/disable actions based on user settings
            this.device.settings.connect(
                'changed::action-blacklist',
                this._changeAction.bind(this)
            );
        }
    }

    get device() {
        return this._device;
    }

    get name() {
        return this._name;
    }

    _activateAction(action, parameter) {
        try {
            parameter = parameter ? parameter.full_unpack() : null;

            if (Array.isArray(parameter)) {
                this[action.name].apply(this, parameter);
            } else if (parameter) {
                this[action.name].call(this, parameter);
            } else {
                this[action.name].call(this);
            }
        } catch(e) {
            debug(e);
        }
    }

    _changeAction() {
        let blacklist = this.device.settings.get_strv('action-blacklist');

        this._gactions.map(action => {
            action.set_enabled(!blacklist.includes(action.name));
        });
    }

    _registerAction(name, meta, blacklist) {
        let action = new Device.Action(Object.assign({ name: name }, meta));

        // Set the enabled state
        action.set_enabled(!blacklist.includes(action.name));

        // Bind the activation
        action.connect('activate', this._activateAction.bind(this));

        this.device.add_action(action);

        // Menu
        let menu = this.device.settings.get_strv('menu');
        let index = menu.indexOf(action.name);

        if (index > -1) {
            this.device.menu.add_action(action, index);
        }

        this._gactions.push(action);
    }

    /**
     *
     */
    handlePacket(packet) { throw Error('Not implemented'); }

    /**
     * Cache JSON parseable properties on this object for persistence. The
     * filename ~/.cache/gsconnect/<device-id>/<plugin-name>.json will be used
     * to store the properties and values.
     *
     * Calling cacheProperties() opens a JSON cache file and reads any stored
     * properties and values onto the current instance. When destroy()
     * is called the properties are automatically stored in the same file.
     *
     * @param {Array} names - A list of this object's property names to cache
     */
    cacheProperties(names) {
        // Ensure the device's cache directory exists
        this._cacheDir = GLib.build_filenamev([
            gsconnect.cachedir,
            this.device.id
        ]);
        GLib.mkdir_with_parents(this._cacheDir, 448);

        this._cacheFile = Gio.File.new_for_path(
            GLib.build_filenamev([this._cacheDir, `${this.name}.json`])
        );

        this._cacheProperties = {};

        for (let name of names) {
            // Make a copy of the default, if it exists
            if (this.hasOwnProperty(name)) {
                this._cacheProperties[name] = JSON.parse(JSON.stringify(this[name]));
            }
        }

        this._readCache().then(this._cacheLoaded.bind(this)).catch(logError);
    }

    cacheFile(bytes) {
    }

    // A method for clearing the cache
    clearCache() {
        for (let name in this._cacheProperties) {
            debug(`clearing ${name} from ${this.name}`);
            this[name] = JSON.parse(JSON.stringify(this._cacheProperties[name]));
        }
    }

    // An overridable function that gets called before the cache is written
    _filterCache(names) {
        return;
    }

    // An overridable callback that is invoked when the cache is done loading
    _cacheLoaded() {}

    _readCache() {
        return new Promise((resolve, reject) => {
            this._cacheFile.load_contents_async(null, (file, res) => {
                try {
                    let cache = file.load_contents_finish(res)[1];
                    cache = JSON.parse(cache);

                    for (let name in this._cacheProperties) {
                        if (typeof this[name] === typeof cache[name]) {
                            this[name] = cache[name];
                        }
                    }
                } catch (e) {
                    logWarning(`${this.name} cache: ${e.message}`, this.device.name);
                } finally {
                    resolve();
                }
            });
        });
    }

    _writeCache() {
        try {
            this._filterCache(this._cacheProperties);

            let cache = {};

            for (let name in this._cacheProperties) {
                cache[name] = this[name];
            }

            this._cacheFile.replace_contents(
                JSON.stringify(cache),
                null,
                false,
                Gio.FileCreateFlags.REPLACE_DESTINATION,
                null
            );
        } catch (e) {
            debug(`error writing ${this.name} cache: ${e.message}`);
        }
    }

    /**
     * The destroy function
     */
    destroy() {
        this.emit('destroy');

        this._gactions.map(action => {
            this.device.menu.remove_action(`device.${action.name}`);
            this.device.remove_action(action.name);
        });

        if (this._cacheFile !== undefined) {
            this._writeCache();
        }

        GObject.signal_handlers_destroy(this.settings);
        GObject.signal_handlers_destroy(this);
    }
});

