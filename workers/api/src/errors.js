export class ApiError extends Error {
  constructor(status, code, message, details = undefined) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ProviderError extends ApiError {
  constructor(provider, message = "The configured provider did not return a usable response.") {
    super(502, "PROVIDER_ERROR", message);
    this.name = "ProviderError";
    this.provider = provider;
  }
}
