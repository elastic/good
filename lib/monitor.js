'use strict';

const Os = require('os');
const { pipeline, finished } = require('stream');

const Hoek = require('@hapi/hoek');
const Oppsy = require('@hapi/oppsy');

const Package = require('../package.json');
const Utils = require('./utils');


const internals = {
    host: Os.hostname(),
    appVer: Package.version
};


module.exports = internals.Monitor = class {

    constructor(server, options) {

        this._state = { report: false };
        this._server = server;
        this._reporters = new Map();
        this._extensionListeners = [];
        this._registeredMainEvents = false;
        this._requiresStop = false;

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

        if (this._requiresStop) {
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

        for (const reporterName in this.settings.reporters) {
            const streamsSpec = this.settings.reporters[reporterName];
            if (!streamsSpec.length) {
                continue;
            }

            const streamObjs = [];
            for (let i = 0; i < streamsSpec.length; ++i) {
                const spec = streamsSpec[i];

                // Already created stream

                if (typeof spec.pipe === 'function') {
                    streamObjs.push(spec);
                    continue;
                }

                // If this is stderr or stdout

                if (process[spec]) {
                    streamObjs.push(process[spec]);
                    continue;
                }

                const isFn = typeof spec.module === 'function';
                const moduleName = isFn ? spec.module.name || `The unnamed module at position ${i}` : spec.module;
                let Ctor = isFn ? spec.module : require(require.resolve(spec.module, { paths: require.main.paths }));
                Ctor = spec.name ? Ctor[spec.name] : Ctor;
                Hoek.assert(typeof Ctor === 'function', `Error in ${reporterName}. ${moduleName} must be a constructor function.`);

                const stream = spec.args ? new Ctor(...spec.args) : new Ctor();
                Hoek.assert(typeof stream.pipe === 'function', `Error in ${reporterName}. ${moduleName} must create a stream that has a pipe function.`);

                streamObjs.push(stream);
            }

            this._reporters.set(reporterName, setupPipeline(streamObjs, (err) => {

                if (err) {
                    console.error(`There was a problem (${err}) in ${reporterName} and it has been destroyed.`);
                    console.error(err);
                }
            }));
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

        for (const event of this.settings.extensions) {
            const listener = (...args) => {

                const payload = {
                    event,
                    timestamp: Date.now(),
                    payload: args
                };

                this.push(() => Object.assign({}, payload));
            };

            this._server.events.on(event, listener);

            // Store a reference to the listener so we can remove them later
            this._extensionListeners.push({
                event,
                listener
            });
        }

        this._requiresStop = true;
    }

    stop() {

        this._requiresStop = false;
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
            reporter.end();
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
};

const setupPipeline = (streams, onFinished) => {

    const stream = streams[0];

    if (streams.length === 1) {
        finished(stream, onFinished);
    }
    else {
        pipeline(streams, onFinished);
    }

    return stream;
};
