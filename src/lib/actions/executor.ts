import type { DetectedEvent, Result } from '@/lib/types';
import {
  type Confirmation,
  isMintedConfirmation,
  isValidConfirmation,
} from '@/lib/actions/confirmation';

export type Action =
  | {
      actionId: string;
      kind: 'forwardToCalendar';
      event: DetectedEvent;
      itemId: string;
    }
  | {
      actionId: string;
      kind: 'shareWithFamily';
      itemId: string;
      recipient: string;
    }
  | {
      actionId: string;
      kind:
        | 'sendMessage'
        | 'deleteOriginal'
        | 'openLink'
        | 'pay'
        | 'commitCalendarChange'
        | 'commitMedication';
      payload: unknown;
    }
  | {
      actionId: string;
      kind: 'eraseAll';
      step1ActionId: string;
      step2ActionId: string;
    };

export type ActionSideEffects = {
  saveCalendarEvent: (
    e: DetectedEvent,
    itemId: string
  ) => Promise<Result<void, string>>;
  sendFamilyShare: (
    itemId: string,
    recipient: string
  ) => Promise<Result<void, string>>;
  runProtectedSideEffect: (
    kind: string,
    payload: unknown
  ) => Promise<Result<void, string>>;
  runEraseAll: () => Promise<Result<void, string>>;
};

export type ExecuteError = {
  code: 'unconfirmed' | 'mismatch' | 'failed';
  message: string;
};

export type ProposalState = {
  status: 'pending' | 'confirmed' | 'dismissed';
};

export function createProposalState(): ProposalState {
  return { status: 'pending' };
}

export function dismissProposal(_state: ProposalState): ProposalState {
  return { status: 'dismissed' };
}

export function idleProposal(
  state: ProposalState,
  _elapsedMs?: number
): ProposalState {
  return { status: state.status };
}

function isStepPair(
  value: unknown
): value is { step1?: Confirmation; step2?: Confirmation } {
  return (
    typeof value === 'object' &&
    value !== null &&
    ('step1' in value || 'step2' in value)
  );
}

export async function execute(
  action: Action,
  confirmation:
    | Confirmation
    | undefined
    | { step1?: Confirmation; step2?: Confirmation },
  deps: ActionSideEffects
): Promise<Result<void, ExecuteError>> {
  if (action.kind === 'eraseAll') {
    if (!isStepPair(confirmation)) {
      return {
        ok: false,
        error: {
          code: 'unconfirmed',
          message: 'Please confirm both steps before erasing all data.',
        },
      };
    }

    const { step1, step2 } = confirmation;
    if (!isMintedConfirmation(step1) || !isMintedConfirmation(step2)) {
      return {
        ok: false,
        error: {
          code: 'unconfirmed',
          message: 'Please confirm both steps before erasing all data.',
        },
      };
    }

    if (
      !isValidConfirmation(step1, action.step1ActionId) ||
      !isValidConfirmation(step2, action.step2ActionId)
    ) {
      return {
        ok: false,
        error: {
          code: 'mismatch',
          message: 'That confirmation does not match this action.',
        },
      };
    }

    const eraseRes = await deps.runEraseAll();
    if (!eraseRes.ok) {
      return {
        ok: false,
        error: {
          code: 'failed',
          message: eraseRes.error,
        },
      };
    }
    return { ok: true, value: undefined };
  }

  if (!isMintedConfirmation(confirmation)) {
    return {
      ok: false,
      error: {
        code: 'unconfirmed',
        message: 'Please tap confirm before doing this.',
      },
    };
  }

  if (!isValidConfirmation(confirmation, action.actionId)) {
    return {
      ok: false,
      error: {
        code: 'mismatch',
        message: 'That confirmation does not match this action.',
      },
    };
  }

  let res: Result<void, string>;
  switch (action.kind) {
    case 'forwardToCalendar':
      res = await deps.saveCalendarEvent(action.event, action.itemId);
      break;
    case 'shareWithFamily':
      res = await deps.sendFamilyShare(action.itemId, action.recipient);
      break;
    case 'sendMessage':
    case 'deleteOriginal':
    case 'openLink':
    case 'pay':
    case 'commitCalendarChange':
    case 'commitMedication':
      res = await deps.runProtectedSideEffect(action.kind, action.payload);
      break;
  }

  if (!res.ok) {
    return {
      ok: false,
      error: {
        code: 'failed',
        message: res.error,
      },
    };
  }

  return { ok: true, value: undefined };
}
