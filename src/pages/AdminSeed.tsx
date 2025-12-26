import { useAuth } from '../context/AuthContext';
import { getFirestore, doc, setDoc, getDoc, writeBatch } from 'firebase/firestore';
import { useState } from 'react';

export default function AdminSeed() {
  const { role } = useAuth();
  const [msg, setMsg] = useState<string>('');
  const db = getFirestore();
  if (!role?.roles?.admin) return <div className="card p-4">Admin only.</div>;

  const seedOnce = async () => {
    setMsg('Seeding...');
    try {
      const flag = await getDoc(doc(db,'meta','seed_v1'));
      if (flag.exists()) { setMsg('Already seeded.'); return; }

      const bp = writeBatch(db);

      // Projects
      const projects = [
        'Artawi - Workshop','CPS03 - Laydown Area Repair','CPS07 - AX46','CPS07 - R 679 DZ 59',
        'DS01 - E&I','DS01 - MOC 493 & 494','DS01 - VRP TR I&H','DS02 - E&I','DS02 - Scaffolding',
        'DS03 - Hydrovac','DS04 - Hydrovac','DS04 - Scaffolding','DS05 - Band Wall','DS05 - MF5/4',
        'DS05 - Scaffolding','DS05 - TAR MOC 701','MDS - MOC374','MDS - Scaffolding',
        'MSDS - VRP TR I DH Lower','NIDS - HS18','PWRI','QDS - MOC 857','QDS - MOC356',
        'QDS - Scaffolding','QDS - TRP TK02','Qurainat - Train A&B PWD Line Represents',
        'RPP - Scaffolding','SDS - BR36','SDS - BU35','SDS - Scaffolding','Other'
      ];
      projects.forEach((p,i)=> bp.set(doc(db,'projects',`P${i+1}`), { nameEn: p, nameAr: p, active:true }));

      // Engineers (AR/EN)
      const engineers = [
        { ar:'Ahmed Mohsen Hadi', en:'Ahmed Mohsen Hadi' },
        { ar:'Abdul Samad Hadi',  en:'Abdul Samad Hadi' },
        { ar:'Yousif Chaseb',      en:'Yousif Chaseb' },
        { ar:'Hussain Abdul Karem', en:'Hussain Abdul Karem' },
      ];
      engineers.forEach((e,i)=> bp.set(doc(db,'engineers',`E${i+1}`), { nameAr:e.ar, nameEn:e.en, active:true }));

      // Items (HSE)
      const itemsHSE = [
        ['HSE-001','Safety Helmet','Hard hat for impact protection','pcs',50,'HSE','2025-10-25','Safety Helmet','Hard hat for impact protection'],
        ['HSE-002','Work Gloves','Thick leather gloves for heavy duty','pair',120,'HSE','2025-10-25','Work Gloves','Thick leather gloves for heavy duty'],
        ['HSE-003','Safety Goggles','Clear protective goggles','pcs',85,'HSE','2025-10-25','Safety Goggles','Clear protective goggles'],
        ['HSE-004','Face Mask N95','N95 mask for dust/chemicals','box',40,'HSE','2025-10-26','Face Mask N95','N95 mask for dust/chemicals'],
        ['HSE-005','Reflective Vest','Hi-vis reflective vest','pcs',200,'HSE','2025-10-26','Reflective Vest','Hi-vis reflective vest'],
        ['HSE-006','Safety Shoes','Steel-toe slip-resistant shoes','pair',60,'HSE','2025-10-27','Safety Shoes','Steel-toe slip-resistant shoes'],
        ['HSE-007','Fire Extinguisher','6kg dry powder extinguisher','pcs',30,'HSE','2025-10-27','Fire Extinguisher','6kg dry powder extinguisher'],
        ['HSE-008','First Aid Kit','Basic kit for minor injuries','kit',15,'HSE','2025-10-28','First Aid Kit','Basic kit for minor injuries'],
        ['HSE-009','Warning Sign','Plastic "Work Area" sign','pcs',10,'HSE','2025-10-28','Warning Sign','Plastic "Work Area" sign'],
        ['HSE-010','Sanitizer','Surface and hand sanitizer','liter',50,'HSE','2025-10-29','Sanitizer','Surface and hand sanitizer']
      ];
      // Items (TRP)
      const itemsTRP = [
        ['TRP-001','Engine Oil','Synthetic engine oil','liter',300,'TRP','2025-10-20','Engine Oil','Synthetic engine oil'],
        ['TRP-002','Truck Tire','22.5 inch heavy duty tire','pcs',45,'TRP','2025-10-21','Truck Tire','22.5 inch heavy duty tire'],
        ['TRP-003','Car Battery','12V 75Ah battery','pcs',70,'TRP','2025-10-21','Car Battery','12V 75Ah battery'],
        ['TRP-004','Diesel Fuel','High-quality diesel','gallon',1500,'TRP','2025-10-22','Diesel Fuel','High-quality diesel'],
        ['TRP-005','Tie Rope','Strong nylon rope','meter',500,'TRP','2025-10-22','Tie Rope','Strong nylon rope'],
        ['TRP-006','Forklift','Electric 2T forklift','pcs',5,'TRP','2025-10-23','Forklift','Electric 2T forklift'],
        ['TRP-007','Pallet','Wooden pallet','pcs',250,'TRP','2025-10-23','Pallet','Wooden pallet'],
        ['TRP-008','Warning Tape','Red/white hazard tape','roll',90,'TRP','2025-10-24','Warning Tape','Red/white hazard tape'],
        ['TRP-009','GPS Device','Vehicle tracking device','pcs',15,'TRP','2025-10-24','GPS Device','Vehicle tracking device'],
        ['TRP-010','Flashlight','Portable LED flashlight','pcs',110,'TRP','2025-10-25','Flashlight','Portable LED flashlight']
      ];
      // Items (VRP)
      const itemsVRP = [
        ['VRP-001','Notebook','Leather cover notebook','pcs',200,'VRP','2025-10-15','Notebook','Leather cover notebook'],
        ['VRP-002','Ink Pen','Premium gift pen','pcs',150,'VRP','2025-10-16','Ink Pen','Premium gift pen'],
        ['VRP-003','Business Card','Printed business cards','box',30,'VRP','2025-10-16','Business Card','Printed business cards'],
        ['VRP-004','Company Brochure','Services/products brochure','booklet',500,'VRP','2025-10-17','Company Brochure','Services/products brochure'],
        ['VRP-005','Document Bag','Presentation bag','pcs',100,'VRP','2025-10-17','Document Bag','Presentation bag'],
        ['VRP-006','Coffee Mug','Mug with company logo','pcs',300,'VRP','2025-10-18','Coffee Mug','Mug with company logo'],
        ['VRP-007','Event Ticket','Marketing conference ticket','ticket',5,'VRP','2025-10-18','Event Ticket','Marketing conference ticket'],
        ['VRP-008','Partnership Contract','Template contract','form',75,'VRP','2025-10-19','Partnership Contract','Template contract'],
        ['VRP-009','Projector','Portable projector','pcs',3,'VRP','2025-10-19','Projector','Portable projector'],
        ['VRP-010','USB Drive','64GB with profiles','pcs',90,'VRP','2025-10-20','USB Drive','64GB with profiles']
      ];

      const all = [...itemsHSE, ...itemsTRP, ...itemsVRP];
      all.forEach((r:any) => {
        const [code, nameAr, descAr, unit, qty, dept, updatedAt, nameEn, descEn] = r;
        const allowedUnits = [unit];
        bp.set(doc(db,'items', code), {
          itemCode: code, nameAr, nameEn, descriptionAr: descAr, descriptionEn: descEn,
          unit, allowedUnits, qty: Number(qty), ownerDeptId: dept, updatedAt
        });
      });

      await bp.commit();
      await setDoc(doc(db,'meta','seed_v1'), { at: new Date().toISOString() });
      setMsg('Seed completed.');
    } catch (e:any) {
      setMsg('Error: ' + (e.message||''));
    }
  };

  return (
    <div className="card p-4 space-y-3">
      <div className="font-semibold">Admin Seed (v1)</div>
      <button className="btn-primary" onClick={seedOnce}>Run Seed</button>
      {msg && <div className="text-sm">{msg}</div>}
    </div>
  );
}

