export class TrackerConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackerConfigError";
  }
}

export class TrackerConfigConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrackerConfigConflictError";
  }
}
