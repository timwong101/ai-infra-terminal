export type SecRecentFilings = {
  accessionNumber: string[];
  filingDate: string[];
  reportDate: string[];
  acceptanceDateTime: string[];
  form: string[];
  primaryDocument: string[];
  primaryDocDescription: string[];
};

export type SecSubmissionsResponse = {
  cik: string;
  name: string;
  tickers: string[];
  filings: {
    recent: SecRecentFilings;
  };
};
