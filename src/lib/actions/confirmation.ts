declare const confirmationBrand: unique symbol;

export type Confirmation = {
  readonly [confirmationBrand]: true;
  readonly actionId: string;
};

const mintedConfirmations = new WeakMap<object, string>();

export function confirmFromTap(actionId: string): Confirmation {
  if (typeof actionId !== 'string' || actionId.trim().length === 0) {
    throw new Error('Cannot confirm an action without an actionId.');
  }

  const token = Object.freeze({ actionId }) as Confirmation;
  mintedConfirmations.set(token, actionId);
  return token;
}

export function isMintedConfirmation(c: unknown): c is Confirmation {
  if (typeof c !== 'object' || c === null) {
    return false;
  }
  return mintedConfirmations.has(c);
}

export function isValidConfirmation(
  c: unknown,
  expectedActionId: string
): c is Confirmation {
  if (
    typeof expectedActionId !== 'string' ||
    expectedActionId.trim().length === 0
  ) {
    return false;
  }

  if (typeof c !== 'object' || c === null) {
    return false;
  }

  const mintedActionId = mintedConfirmations.get(c);
  if (mintedActionId === undefined) {
    return false;
  }

  return (
    mintedActionId === expectedActionId &&
    (c as { actionId?: unknown }).actionId === expectedActionId
  );
}
