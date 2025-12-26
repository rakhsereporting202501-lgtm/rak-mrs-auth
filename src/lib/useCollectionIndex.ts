import { useEffect, useState } from 'react';
import { collection, getDocs, getFirestore } from 'firebase/firestore';

type CacheEntry = {
  data: Record<string, any> | null;
  promise: Promise<Record<string, any>> | null;
};

const cacheMap: Record<string, CacheEntry> = {};

async function fetchCollection(name: string): Promise<Record<string, any>> {
  const db = getFirestore();
  const snap = await getDocs(collection(db, name));
  const out: Record<string, any> = {};
  snap.docs.forEach((docSnap) => {
    out[docSnap.id] = { id: docSnap.id, ...(docSnap.data() as any) };
  });
  return out;
}

export function useCollectionIndex<T = any>(collectionName: string) {
  if (!cacheMap[collectionName]) {
    cacheMap[collectionName] = { data: null, promise: null };
  }
  const cache = cacheMap[collectionName];
  const [data, setData] = useState<Record<string, T>>(() => (cache.data || {}) as Record<string, T>);
  const [loading, setLoading] = useState<boolean>(() => !cache.data);

  useEffect(() => {
    let mounted = true;
    if (cache.data) {
      setData(cache.data as Record<string, T>);
      setLoading(false);
      return () => { mounted = false; };
    }
    if (!cache.promise) {
      cache.promise = fetchCollection(collectionName);
    }
    cache.promise
      .then((entries) => {
        cache.data = entries;
        if (mounted) {
          setData(entries as Record<string, T>);
          setLoading(false);
        }
      })
      .catch(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [collectionName]);

  return { data, loading };
}
