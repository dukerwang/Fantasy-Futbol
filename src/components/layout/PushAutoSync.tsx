'use client';

import { useEffect } from 'react';
import { syncPushSubscription } from '@/lib/push/subscribe';

export default function PushAutoSync() {
  useEffect(() => {
    syncPushSubscription();
  }, []);

  return null;
}
