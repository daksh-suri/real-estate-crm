const httpError = (statusCode, message) => Object.assign(new Error(message), { statusCode });
const notFoundError = (message) => httpError(404, message);
const forbiddenError = (message) => httpError(403, message);
const badRequestError = (message) => httpError(400, message);
const conflictError = (message) => httpError(409, message);

module.exports = { httpError, notFoundError, forbiddenError, badRequestError, conflictError };
