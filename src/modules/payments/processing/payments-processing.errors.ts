export class InsufficientHotLiquidityError extends Error {
  constructor(message = 'Insufficient hot wallet liquidity') {
    super(message);
    this.name = 'InsufficientHotLiquidityError';
  }
}

export class SweepNotWorthItError extends Error {
  constructor(message = 'Sweep amount below minimum threshold') {
    super(message);
    this.name = 'SweepNotWorthItError';
  }
}

export class SweepFailedError extends Error {
  constructor(message = 'Sweep failed') {
    super(message);
    this.name = 'SweepFailedError';
  }
}
