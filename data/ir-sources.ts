import { COMPANY_REGISTRY } from "@/data/company-registry";

export type IrSourceConfig = {
  companyId: string;
  companyName: string;
  ticker: string;
  pages: string[];
  allowedHosts: string[];
  includePathFragments: string[];
  catalogOnlyHosts?: string[];
};

export const irSources: IrSourceConfig[] = COMPANY_REGISTRY.map((company) => ({
  companyId: company.id,
  companyName: company.name,
  ticker: company.ticker,
  ...company.ir,
}));
