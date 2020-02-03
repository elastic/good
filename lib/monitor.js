'use strict';

// Load modules

const { Transform } = require('stream');

const Oppsy = require('oppsy');

const Utils = require('./utils');


class Monitor {
    constructor(server, options) {

        this._state = { report: false };
        this._server = server;
        this._reporters = new Map();
        this._extensionListeners = [];
        this._registeredMainEvents = false;

        // Event handlers
        this._requestLogHandler = (request, event) => {

            this.push(() => new Utils.RequestLog(this._reqOptions, request, event));
        };

        this._logHandler = (event) => {

            this.push(() => new Utils.ServerLog(event));
        };

        this._errorHandler = (request, error) => {

            this.push(() => new Utils.RequestError(this._reqOptions, request, error));
        };

        this._responseHandler = (request) => {

            this.push(() => new Utils.RequestSent(this._reqOptions, this._resOptions, request, this._server));
        };

        this._opsHandler = (results) => {

            this.push(() => new Utils.Ops(results));
        };

        this.configure(options);
    }

    configure(options) {

        if (this._reporters.size > 0 || this._extensionListeners.length > 0) {
            throw new Error(`Good must be stopped before restarting`);
        }

        this.settings = options;

        const reducer = (obj, value) => {

            obj[value] = true;
            return obj;
        };

        this._reqOptions = this.settings.includes.request.reduce(reducer, {});
        this._resOptions = this.settings.includes.response.reduce(reducer, {});

        this._ops = this.settings.ops && new Oppsy(this._server, this.settings.ops.config);
    }

    startOps() {

        this._ops && this._ops.start(this.settings.ops.interval);
    }

    start() {

        for (const [reporterName, stream] of Object.entries(this.settings.reporters)) {
            if (!(stream instanceof Transform)) {
                throw new Error('expected reporter values to be Transform streams');
            }

            this._reporters.set(reporterName, stream);
        }

        this._state.report = true;

        // Initialize Events. Make sure we only do this once to prevent duplicate events.
        if (!this._registeredMainEvents) {
            this._server.events.on('log', this._logHandler);
            this._server.events.on('response', this._responseHandler);
            this._server.events.on({ name: 'request', channels: ['error'] }, this._errorHandler);
            this._server.events.on({ name: 'request', channels: ['app'] }, this._requestLogHandler);
            this._registeredMainEvents = true;
        }

        if (this._ops) {
            this._ops.on('ops', this._opsHandler);
            this._ops.on('error', console.error);
        }

        // Events can not be any of ['log', 'ops', 'request', 'response', 'tail']
        this.settings.extensions.forEach((event) => {

            const listener = (...args) => {

                this.push(() => {

                    return Object.assign({}, {
                        event,
                        timestamp: Date.now(),
                        payload: args
                    });
                });
            };

            // Store a reference to the listener so we can remove them later
            this._extensionListeners.push({
                event, listener
            });

            this._server.events.on(event, listener);
        });
    }

    stop() {

        this._state.report = false;

        // Remove listeners for any generated extensions
        this._extensionListeners.forEach(({ event, listener }) => {

            this._server.events.removeListener(event, listener);
        });
        this._extensionListeners = [];

        if (this._ops) {
            this._ops.stop();
            this._ops.removeAllListeners();
        }

        for (const reporter of this._reporters.values()) {
            reporter.destroy();
        }
        this._reporters = new Map();
    }

    push(value) {

        if (this._state.report) {
            for (const reporter of this._reporters.values()) {
                if (reporter.destroyed === false) {
                    reporter.write(value());
                }
            }
        }
    }
}

module.exports = Monitor;