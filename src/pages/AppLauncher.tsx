import { useNavigate } from 'react-router-dom';
import { Boxes, ClipboardList, FileText, LogOut, User } from 'lucide-react';
import { getAuth, signOut } from 'firebase/auth';
import { useAuth } from '../context/AuthContext';
import { getDisplayName } from '../lib/displayName';

type AppCardProps = {
  title: string;
  description: string;
  Icon: any;
  onClick: () => void;
};

function AppCard({ title, description, Icon, onClick }: AppCardProps) {
  return (
    <button
      type="button"
      className="card p-6 text-right hover:shadow-md min-h-[180px] flex flex-col justify-between"
      onClick={onClick}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xl font-semibold text-gray-900">{title}</div>
          <div className="mt-2 text-sm text-gray-600 leading-6">{description}</div>
        </div>
        <div className="h-12 w-12 rounded-2xl bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
          <Icon className="h-6 w-6" />
        </div>
      </div>
      <div className="mt-5 text-sm font-semibold text-blue-700">فتح</div>
    </button>
  );
}

export default function AppLauncher() {
  const { user, role } = useAuth();
  const nav = useNavigate();
  const name = getDisplayName(role, user) || user?.email || 'مستخدم';
  const logoSrc = `${import.meta.env.BASE_URL}logo.svg`;

  return (
    <div className="min-h-screen bg-white" dir="rtl">
      <div className="max-w-5xl mx-auto px-4 py-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <img src={logoSrc} className="h-8 w-8" alt="Logo" />
            <div>
              <div className="text-base font-semibold text-gray-900">تطبيقات RAK</div>
              <div className="text-xs text-gray-500">{name}</div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-ghost hidden sm:flex items-center gap-2" onClick={() => nav('/profile')}>
              <User className="h-4 w-4 icon-blue" />
              <span>الملف الشخصي</span>
            </button>
            <button type="button" className="btn-ghost flex items-center gap-2" onClick={() => signOut(getAuth())}>
              <LogOut className="h-4 w-4 icon-blue" />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </div>

        <div className="pt-16 sm:pt-24">
          <div className="text-center mb-8">
            <div className="text-2xl sm:text-3xl font-bold text-gray-900">اختر التطبيق</div>
            <div className="mt-2 text-sm text-gray-600">اختر التطبيق الذي تريد العمل عليه.</div>
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <AppCard
              title="نظام الطلبات"
              description="الطلبات والمخزن والتقارير والمستخدمين والملف الشخصي."
              Icon={Boxes}
              onClick={() => nav('/requests')}
            />
            <AppCard
              title="خطط العمل"
              description="خطط العمل اليومية لتوزيع الموظفين والفرق على المشاريع."
              Icon={ClipboardList}
              onClick={() => nav('/wp')}
            />
          </div>
          <div className="mt-6 flex items-center justify-center text-xs text-gray-500 gap-2">
            <FileText className="h-4 w-4" />
            <span>تسجيل دخول واحد، وتطبيقات منفصلة.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
