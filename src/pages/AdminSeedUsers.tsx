import { useState } from 'react';
import { doc, getDoc, getFirestore, setDoc, writeBatch } from 'firebase/firestore';
import { useAuth } from '../context/AuthContext';

type SeedUser = {
  fullName: string;
  username: string;
  email: string;
  uid: string;
  roles: Array<'admin' | 'deptManager' | 'requester' | 'storeOfficer'>;
  departments: string[];
};

const USERS: SeedUser[] = [
  {
    fullName: 'Ali Majed',
    username: 'ali.majed',
    email: 'ali.majed@rak.com',
    uid: 'xNEznJJ65TU4EBpXfaRKC3L9dZG2',
    roles: ['storeOfficer'],
    departments: ['VRP', 'TRP'],
  },
  {
    fullName: 'Hussain Abdul Kareem',
    username: 'hussain.abdulkareem',
    email: 'hussain.abdulkareem@rak.com',
    uid: 'ted6NJZynMdQFKTZqpsWZJ0uW9S2',
    roles: ['requester'],
    departments: ['VRP'],
  },
  {
    fullName: 'Hasanin Adil',
    username: 'hasanin.adil',
    email: 'hasanin.adil@rak.com',
    uid: 'wiBMUGFzB3OFLJcqwE38zKpaqOr1',
    roles: ['requester', 'storeOfficer'],
    departments: ['VRP'],
  },
  {
    fullName: 'Mohammed Adnan',
    username: 'mohammed.adnan',
    email: 'mohammed.adnan@rak.com',
    uid: 'zUOXvNDfeHSqFO5bSYAgiECqZ342',
    roles: ['requester'],
    departments: ['TRP'],
  },
  {
    fullName: 'Abdul Samad Hadi',
    username: 'abdulsamad.hadi',
    email: 'abdulsamad.hadi@rak.com',
    uid: 'ozpFoLSq7JRfZZrXlO7m6Mm7LHn1',
    roles: ['requester', 'storeOfficer'],
    departments: ['TRP'],
  },
  {
    fullName: 'Ahmed Jehad',
    username: 'ahmed.jehad',
    email: 'ahmed.jehad@rak.com',
    uid: 'T6cxpyT4dqedMHe6LQ6mz0MJZLo2',
    roles: ['deptManager', 'requester', 'storeOfficer'],
    departments: ['Pipline Project', 'Pipline Ops'],
  },
  {
    fullName: 'Jaffer Akeel',
    username: 'jaffer.akeel',
    email: 'jaffer.akeel@rak.com',
    uid: 'qlZZ6TGs6BOCU611BQf7IZ1xPoh2',
    roles: ['deptManager', 'requester', 'storeOfficer'],
    departments: ['Pipline Project', 'Pipline Ops'],
  },
  {
    fullName: 'Ghanam Khalel',
    username: 'ghanam.khalel',
    email: 'ghanam.khalel@rak.com',
    uid: 'LW9vjYJfQOWaiwPrvGB57a4aHbj2',
    roles: ['deptManager', 'requester', 'storeOfficer'],
    departments: ['CPS', 'Leak', 'Maintenace'],
  },
  {
    fullName: 'Store Officer',
    username: 'pipline.storeofficer',
    email: 'pipline.storeofficer@rak.com',
    uid: 'H4fLRhUnoGQ7h5tWLTYmp5he9Qr2',
    roles: ['storeOfficer'],
    departments: ['Pipline Project', 'Pipline Ops', 'CPS', 'Leak', 'Maintenace'],
  },
  {
    fullName: 'Nasser SaadAllah',
    username: 'nasser.saadallah',
    email: 'nasser.saadallah@rak.com',
    uid: 'S0IUmB4tQ7OS4QIKL59xyNoOs1G2',
    roles: ['requester'],
    departments: [],
  },
  {
    fullName: 'Ammer Aouad',
    username: 'ammer.aouad',
    email: 'ammer.aouad@rak.com',
    uid: '7i7yg7pNjZbihO4DcrGC0R2NU2R2',
    roles: ['deptManager', 'requester', 'storeOfficer'],
    departments: ['EI'],
  },
  {
    fullName: 'Nashwan Faisal',
    username: 'nashwan.faisal',
    email: 'nashwan.faisal@rak.com',
    uid: 'Kt2oaPXGlhNGWyGifG4ngGAWPEO2',
    roles: ['requester'],
    departments: ['EI'],
  },
  {
    fullName: 'Store Officer',
    username: 'ei.storeofficer',
    email: 'ei.storeofficer@rak.com',
    uid: 'ypUphfNw01Wk6g0UAxn3jcBwEMs1',
    roles: ['storeOfficer'],
    departments: ['EI'],
  },
];

const ROLE_KEYS = ['admin', 'deptManager', 'requester', 'storeOfficer'] as const;

export default function AdminSeedUsers() {
  const { role } = useAuth();
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const db = getFirestore();

  if (!role?.roles?.admin) return <div className="card p-4">Admin only.</div>;

  const runSeed = async () => {
    if (busy) return;
    setBusy(true);
    setStatus('Running seed...');
    try {
      const flagRef = doc(db, 'meta', 'users_seed_v1');
      const flagSnap = await getDoc(flagRef);
      if (flagSnap.exists()) {
        setStatus('Seed already executed.');
        setBusy(false);
        return;
      }

      const batch = writeBatch(db);
      USERS.forEach((user) => {
        const departments = user.departments.map((d) => d.trim()).filter(Boolean);
        const usernameRef = doc(db, 'usernames', user.username);
        batch.set(usernameRef, {
          uid: user.uid,
          email: user.email,
          fullName: user.fullName,
        });

        const rolesRef = doc(db, 'roles', user.uid);
        const roleFlags = ROLE_KEYS.reduce<Record<string, boolean>>((acc, key) => {
          acc[key] = user.roles.includes(key);
          return acc;
        }, {});

        batch.set(rolesRef, {
          fullName: user.fullName,
          email: user.email,
          departmentIds: departments,
          roles: roleFlags,
        });
      });

      await batch.commit();
      await setDoc(doc(db, 'meta', 'users_seed_v1'), {
        at: new Date().toISOString(),
        count: USERS.length,
      });

      setStatus(`Seed completed (${USERS.length} users).`);
    } catch (err: any) {
      setStatus(`Error: ${err?.message || String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="font-semibold">Admin User Seed</div>
      <p className="text-sm text-gray-600">
        Admin-only utility. Run once, then remove this page.
      </p>
      <button className="btn-primary" disabled={busy} onClick={runSeed}>
        {busy ? 'Seeding...' : 'Run User Seed'}
      </button>
      {status && <div className="text-sm">{status}</div>}
    </div>
  );
}
