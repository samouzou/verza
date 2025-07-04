
"use client";

import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface Form1099NecProps {
  formData: {
    year: string;
    payerName: string;
    payerAddress: string;
    payerTin: string;
    recipientName: string;
    recipientAddress: string;
    recipientTin: string;
    nonemployeeCompensation: number;
  };
}

const FormBox = ({
  label,
  value,
  className,
  valueClassName,
  isCurrency = false,
  fullWidth = false,
}: {
  label: string;
  value: string | number;
  className?: string;
  valueClassName?: string;
  isCurrency?: boolean;
  fullWidth?: boolean;
}) => (
  <div className={cn("p-1 border border-black", fullWidth ? "col-span-2" : "", className)}>
    <p className="text-[7px] font-semibold text-gray-600 uppercase tracking-wider">{label}</p>
    <p className={cn("text-xs font-mono break-words pt-1", valueClassName)}>
      {isCurrency ? `$${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : value}
    </p>
  </div>
);

const MultiLineBox = ({ label, lines, className }: { label: string, lines: string[], className?: string }) => (
    <div className={cn("p-1 border border-black flex flex-col", className)}>
        <p className="text-[7px] font-semibold text-gray-600 uppercase tracking-wider">{label}</p>
        <div className="text-xs font-mono break-words pt-1 flex-grow">
            {lines.map((line, index) => <div key={index}>{line}</div>)}
        </div>
    </div>
);


export function Form1099Nec({ formData }: Form1099NecProps) {
  const [payerNameLine1, ...payerAddressLines] = formData.payerAddress.split('\n');
  const [recipientNameLine1, ...recipientAddressLines] = formData.recipientAddress.split('\n');

  return (
    <Card className="max-w-[800px] mx-auto bg-white text-black font-sans relative print-form-container">
      <div className="absolute inset-0 flex items-center justify-center z-0 pointer-events-none">
        <p className="text-destructive/10 dark:text-destructive/5 text-8xl font-bold -rotate-45 select-none">
          DRAFT - FOR INFORMATIONAL PURPOSES ONLY
        </p>
      </div>
      <CardContent className="p-4 relative z-10">
        <div className="flex items-start">
          <div className="flex items-center gap-2">
            <div className="w-16">
              <p className="text-[6px] font-semibold">FORM <span className="text-2xl font-bold">1099-NEC</span></p>
              <p className="text-[6px] font-semibold">OMB No. 1545-0116</p>
              <p className="text-center text-[7px] mt-1">
                <span className="font-bold text-lg">{formData.year}</span><br/>
                Form 1099-NEC
              </p>
            </div>
             <p className="text-2xl font-bold pl-2 border-l-2 border-black">
                Nonemployee<br/>Compensation
             </p>
          </div>
          <div className="ml-auto text-right text-[7px] font-semibold">
            <p>Copy A</p>
            <p>For</p>
            <p>Internal Revenue</p>
            <p>Service Center</p>
            <p>File with Form 1096.</p>
            <p className="mt-2 font-bold">For Privacy Act and<br/>Paperwork Reduction<br/>Act Notice, see the<br/>current General<br/>Instructions for<br/>Certain Information<br/>Returns.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px mt-2 bg-black border border-black">
          <MultiLineBox label="PAYER'S name, street address, city or town, state or province, country, ZIP or foreign postal code, and telephone no." 
            lines={[formData.payerName, ...payerAddressLines]}
            className="row-span-2 bg-white"
          />
          <div className="grid grid-cols-2 gap-px bg-black">
            <FormBox label="1 Nonemployee compensation" value={formData.nonemployeeCompensation} isCurrency />
            <FormBox label="2 Payer made direct sales totaling $5,000 or more of consumer products to a buyer (recipient) for resale" value="$" />
          </div>
           <div className="bg-white p-1 border border-black">
             <p className="text-[7px] font-semibold uppercase">VOID</p>
           </div>
          <MultiLineBox label="PAYER'S TIN" value={formData.payerTin} className="bg-white"/>
          <MultiLineBox label="RECIPIENT'S TIN" value={formData.recipientTin} className="bg-white"/>
           <MultiLineBox label="RECIPIENT'S name" lines={[formData.recipientName]} className="row-span-2 bg-white"/>
          <FormBox label="4 Federal income tax withheld" value="$ 0.00" isCurrency/>
          <MultiLineBox label="Street address (including apt. no.)" lines={[...recipientAddressLines]} className="row-span-2 bg-white"/>
          <FormBox label="5 State tax withheld" value="$ 0.00" isCurrency/>
          <FormBox label="6 State/Payer's state no." value=""/>
          <FormBox label="7 State income" value="$ 0.00" isCurrency/>
           <MultiLineBox label="Account number (see instructions)" value="" className="col-span-2 bg-white"/>
        </div>
        <p className="text-xs text-center mt-2 font-semibold">Cat. No. 51804M</p>
        <p className="text-[7px] font-semibold text-center">www.irs.gov/Form1099NEC</p>
      </CardContent>
    </Card>
  );
}
