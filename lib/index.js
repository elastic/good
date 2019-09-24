'use strict';

const Joi = require('@hapi/joi');

const Monitor = require('./monitor');

<<<<<<< HEAD
const internals = {
    validateOptions(options) {

        const result = Joi.validate(options, Schema.monitor);
        Hoek.assert(!result.error, 'Invalid', 'monitorOptions', 'options', result.error);

        return result.value;
    },
    onPostStop(monitor) {
=======
>>>>>>> de106369ca7eda2f6007103a4a6a0dc5420bd866

const internals = {};


internals.reporters = [
    Joi.object({
        pipe: Joi.func().required(),
        start: Joi.func()
    })
        .unknown(),

    Joi.string()
        .valid('stdout', 'stderr'),

    Joi.object({
        module: Joi.alternatives().try(Joi.string(), Joi.func(), Joi.object()).required(),
        name: Joi.string(),
        args: Joi.array().default([])
    })
];


internals.schema = Joi.object({

    includes: Joi.object({
        request: Joi.array().items(Joi.string().valid('headers', 'payload')).default([]),
        response: Joi.array().items(Joi.string().valid('headers', 'payload')).default([])
    })
        .default({
            request: [],
            response: []
        }),

    reporters: Joi.object()
        .pattern(/./, Joi.array().items(...internals.reporters))
        .default({}),

    extensions: Joi.array()
        .items(Joi.string().invalid('log', 'ops', 'request', 'response'))
        .default([]),

    ops: Joi.alternatives([
        Joi.object(),
        Joi.bool().allow(false)
    ])
        .default({
            config: {},
            interval: 15000
        })
})
    .unknown(false);


exports.plugin = {
    name: 'good',
    pkg: require('../package.json'),
    requirements: {
        hapi: '>=17.9.0'
    },
<<<<<<< HEAD
    onPreStart(monitor) {
=======
    register: function (server, options) {
>>>>>>> de106369ca7eda2f6007103a4a6a0dc5420bd866

        const settings = Joi.attempt(options, internals.schema);
        const monitor = new Monitor(server, settings);

<<<<<<< HEAD
            monitor.startOps();
        };
    },
    reconfigure(monitor) {

        return (options) => {

            monitor.stop();
            monitor.configure(internals.validateOptions(options));
            monitor.start();
        };
    }
};


exports.register = (server, options) => {

    // Do the initial configuration
    const monitor = new Monitor(server, internals.validateOptions(options));

    server.ext([{
        type: 'onPostStop',
        method: internals.onPostStop(monitor)
    }, {
        type: 'onPreStart',
        method: internals.onPreStart(monitor)
    }]);

    server.expose('reconfigure', internals.reconfigure(monitor));

    monitor.start();
=======
        server.ext('onPostStop', internals.onPostStop(monitor));
        server.ext('onPreStart', internals.onPreStart(monitor, settings));

        monitor.start();
    }
};


internals.onPostStop = function (monitor) {

    return (server, h) => {

        return monitor.stop();
    };
>>>>>>> de106369ca7eda2f6007103a4a6a0dc5420bd866
};


internals.onPreStart = function (monitor, options) {

    return (server, h) => {

        const interval = options.ops.interval;
        monitor.startOps(interval);
    };
};
