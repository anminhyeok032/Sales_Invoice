export function findReceiverInfo(companies, companyName) {
  return companies.find((c) => c.name === companyName) || {
    regNo: '', name: companyName, president: '', address: '', businessType: '', businessItem: ''
  };
}
