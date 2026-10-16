// Branding and roles for this ERP. The screens themselves live in ./legacy (original app code).
export default {
  key: 'printfloor',
  title: 'Print Floor ERP',
  brand: 'Print Floor',
  company: 'Arihant Enterprises',
  tagline: 'Jobs, paper, stores and dispatch',
  roles: {
    owner: { label: 'Owner', help: 'Full access and control, including logins.' },
    accounts: { label: 'Accounts', help: 'Sales orders, challans for billing, prices, all reports.' },
    factory: { label: 'Factory manager', help: 'Job sheets and recording production. No costs, prices, sales orders or reports.' },
  },
};
