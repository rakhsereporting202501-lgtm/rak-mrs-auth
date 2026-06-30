import { FormEvent, useEffect, useMemo, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { LogIn, Search, X } from 'lucide-react';
import { useWpAuth } from '../context/WpAuthContext';
import { getWpDb } from '../lib/wpFirebase';
import { displayWpPersonName, normalizeWpEmployee, wpEmployeeSearchText } from '../lib/wpPeople';
import { WP_EMPLOYEE_SEED, WP_EMPLOYEES_COLLECTION, type WpEmployee } from '../lib/wpTypes';

const labels = {
  ar: {
    title: 'تسجيل دخول خطط العمل',
    subtitle: 'اختر اسمك من القائمة للمتابعة.',
    name: 'الاسم',
    password: 'كلمة المرور',
    passwordHint: 'هذا الحساب يحتاج كلمة مرور.',
    continue: 'تسجيل دخول',
    search: 'اكتب الاسم أو الكود',
    noResults: 'لا توجد نتائج.',
    language: 'English',
    loading: 'جاري التحميل...',
    clear: 'مسح',
  },
  en: {
    title: 'Work Plans Sign In',
    subtitle: 'Choose your name from the list to continue.',
    name: 'Name',
    password: 'Password',
    passwordHint: 'This account requires a password.',
    continue: 'Sign in',
    search: 'Type name or code',
    noResults: 'No results.',
    language: 'العربية',
    loading: 'Loading...',
    clear: 'Clear',
  },
};

function seedEmployees() {
  return WP_EMPLOYEE_SEED.map((employee) => normalizeWpEmployee({ ...employee, accountType: 'VIEWER', active: true }));
}

export default function WpLogin() {
  const nav = useNavigate();
  const { wpUser, loading: authLoading, login, locale, setLocale } = useWpAuth();
  const t = labels[locale];
  const [employees, setEmployees] = useState<WpEmployee[]>([]);
  const [loading, setLoading] = useState(true);
  const [queryText, setQueryText] = useState('');
  const [selected, setSelected] = useState<WpEmployee | null>(null);
  const [password, setPassword] = useState('');
  const [requiresPassword, setRequiresPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logoSrc = `${import.meta.env.BASE_URL}logo.svg`;

  useEffect(() => {
    if (wpUser) nav('/wp', { replace: true });
  }, [wpUser, nav]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      try {
        const snap = await getDocs(collection(getWpDb(), WP_EMPLOYEES_COLLECTION));
        if (!active) return;
        const fromDb = snap.docs.map((docSnap) => normalizeWpEmployee({ id: docSnap.id, ...(docSnap.data() as any) }));
        setEmployees(fromDb.length ? fromDb : seedEmployees());
      } catch (err) {
        console.warn('WP employees unavailable; using seed data.', err);
        if (active) setEmployees(seedEmployees());
      } finally {
        if (active) setLoading(false);
      }
    };
    load();
    return () => { active = false; };
  }, []);

  const results = useMemo(() => {
    const tokens = queryText.toLowerCase().split(/\s+/).map((token) => token.trim()).filter(Boolean);
    return employees
      .filter((employee) => employee.active !== false)
      .filter((employee) => {
        if (!tokens.length) return true;
        const hay = wpEmployeeSearchText(employee);
        return tokens.every((token) => hay.includes(token));
      })
      .sort((a, b) => displayWpPersonName(a, locale).localeCompare(displayWpPersonName(b, locale)))
      .slice(0, 60);
  }, [employees, queryText, locale]);

  const selectEmployee = (employee: WpEmployee) => {
    setSelected(employee);
    setQueryText(displayWpPersonName(employee, locale));
    setRequiresPassword(employee.accountType === 'COORDINATOR' || employee.accountType === 'ADMIN');
    setPassword('');
    setError(null);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (!selected) return;
    setBusy(true);
    try {
      const result = await login(selected, password);
      if (result.requiresPassword) {
        setRequiresPassword(true);
        return;
      }
      nav('/wp', { replace: true });
    } catch (err: any) {
      const code = err?.code || '';
      if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') {
        setError(locale === 'en' ? 'Wrong password.' : 'كلمة المرور غير صحيحة.');
      } else {
        setError(err?.message || (locale === 'en' ? 'Could not sign in.' : 'تعذر تسجيل الدخول.'));
      }
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) return <div className="p-6 text-center text-gray-500">{t.loading}</div>;

  return (
    <div className="min-h-screen bg-white flex items-center justify-center p-4" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <div className="card w-full max-w-lg p-6">
        <div className="flex items-start justify-between gap-3 mb-5">
          <div className="flex items-center gap-3">
            <img src={logoSrc} alt="Logo" className="h-9 w-9" />
            <div>
              <h1 className="text-2xl font-semibold">{t.title}</h1>
              <p className="text-sm text-gray-500 mt-1">{t.subtitle}</p>
            </div>
          </div>
          <button type="button" className="btn-ghost text-sm" onClick={() => setLocale(locale === 'ar' ? 'en' : 'ar')}>
            {t.language}
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1">{t.name}</label>
            <div className="relative">
              <Search className={`absolute top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 ${locale === 'ar' ? 'right-3' : 'left-3'}`} />
              <input
                className={`input bg-white ${locale === 'ar' ? 'pr-9 pl-10 text-right' : 'pl-9 pr-10 text-left'}`}
                value={queryText}
                placeholder={t.search}
                autoFocus
                onChange={(event) => {
                  setQueryText(event.target.value);
                  setSelected(null);
                  setRequiresPassword(false);
                }}
              />
              {queryText && (
                <button
                  type="button"
                  className={`absolute top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded-full hover:bg-gray-100 ${locale === 'ar' ? 'left-2' : 'right-2'}`}
                  onClick={() => {
                    setQueryText('');
                    setSelected(null);
                    setPassword('');
                    setRequiresPassword(false);
                  }}
                  aria-label={t.clear}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="mt-2 max-h-72 overflow-y-auto rounded-2xl border border-blue-100 bg-blue-50/70">
              {loading && <div className="p-3 text-sm text-gray-500">{t.loading}</div>}
              {!loading && results.map((employee) => {
                const active = selected?.id === employee.id;
                return (
                  <button
                    key={employee.id}
                    type="button"
                    className={`w-full px-3 py-2 text-start border-b border-blue-100 last:border-b-0 hover:bg-white ${active ? 'bg-white text-blue-700' : ''}`}
                    onClick={() => selectEmployee(employee)}
                  >
                    <div className="text-sm font-semibold">{displayWpPersonName(employee, locale)}</div>
                    <div className="text-xs text-gray-500">{employee.position || '-'} - {employee.department || '-'}</div>
                  </button>
                );
              })}
              {!loading && !results.length && <div className="p-3 text-sm text-gray-500">{t.noResults}</div>}
            </div>
          </div>

          {requiresPassword && (
            <div>
              <label className="block text-xs text-gray-500 mb-1">{t.password}</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
              <div className="text-[11px] text-gray-400 mt-1">{t.passwordHint}</div>
            </div>
          )}

          {error && <div className="alert alert-error">{error}</div>}
          <button type="submit" className="btn-primary w-full inline-flex items-center justify-center gap-2 disabled:opacity-50" disabled={!selected || busy}>
            <LogIn className="h-4 w-4" />
            <span>{busy ? t.loading : t.continue}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
