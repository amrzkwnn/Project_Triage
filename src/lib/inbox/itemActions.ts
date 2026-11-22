import type { GroupCategory, InboxItem } from '@/lib/types';
import type { Vault } from '@/lib/vault/schema';

const CHOOSE_CATEGORY_MESSAGE =
  'Please choose a category such as Personal or Family.';
const SAVE_FAILED_MESSAGE =
  'We could not save this message to that category. Nothing was changed. Please try again.';

export async function saveItemToCategoryLocally(params: {
  item: InboxItem;
  category: GroupCategory;
  markHomeHandled?: boolean;
  vault?: Pick<Vault, 'deleteItem' | 'putItem'>;
}): Promise<{ ok: true; item: InboxItem } | { ok: false; errorMessage: string }> {
  const category = typeof params.category === 'string' ? params.category.trim() : '';
  if (category.length === 0 || category.toLowerCase() === 'all') {
    return { ok: false, errorMessage: CHOOSE_CATEGORY_MESSAGE };
  }

  const updated: InboxItem = {
    ...params.item,
    group: category,
    ...(params.markHomeHandled ? { homeHandled: true } : {}),
  };

  const vault = params.vault;
  if (!vault) {
    return { ok: true, item: updated };
  }

  let deletedOld = false;
  if (typeof vault.deleteItem === 'function') {
    const delRes = await vault.deleteItem(params.item.id);
    if (!delRes.ok) {
      return { ok: false, errorMessage: SAVE_FAILED_MESSAGE };
    }
    deletedOld = true;
  }

  const putRes = await vault.putItem(updated);
  if (!putRes.ok) {
    if (deletedOld) {
      await vault.putItem(params.item);
    }
    return { ok: false, errorMessage: SAVE_FAILED_MESSAGE };
  }

  return { ok: true, item: updated };
}
