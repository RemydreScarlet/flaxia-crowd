export class FlaxiaError extends Error {
  constructor(public message: string, public code: string, public status?: number) {
    super(message);
    this.name = 'FlaxiaError';
  }
}

export class AuthenticationError extends FlaxiaError {
  constructor(message = 'Invalid API Key') {
    super(message, 'AUTH_ERROR', 401);
  }
}

export class TaskNotFoundError extends FlaxiaError {
  constructor(taskId: string) {
    super(`Task not found: ${taskId}`, 'TASK_NOT_FOUND', 404);
  }
}

export class ValidationError extends FlaxiaError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400);
  }
}
