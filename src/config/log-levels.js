export const LOG_LEVELS = Object.freeze({
  fatal: 0, error: 1, warning: 2, info: 3, http: 4, debug: 5,
});

export const DEFAULT_LOG_LEVELS = Object.freeze({
  development: 'debug', test: 'debug', production: 'info',
});
