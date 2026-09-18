export class ServiceError<Code> extends Error {
  constructor(public readonly code: Code) {
    super(String(code));
  }
}
