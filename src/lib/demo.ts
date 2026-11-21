import type { Claim, Employee } from '../types';

/** Entirely fictional, intentionally mixed-quality data for exploring the product. */
export function generateDemo(): { claims: Claim[]; employees: Employee[] } {
  const employees: Employee[] = [
    { id: 'EMP-001', name: 'Olivia Chen', department: 'Sales', status: 'active', manager: 'Morgan Reed' },
    { id: 'EMP-002', name: 'Marcus Johnson', department: 'Engineering', status: 'active', manager: 'Avery Brooks' },
    { id: 'EMP-003', name: 'Sofia Rivera', department: 'Marketing', status: 'active', manager: 'Taylor Kim' },
    { id: 'EMP-004', name: 'James Wilson', department: 'Operations', status: 'active', manager: 'Jordan Ellis' },
    { id: 'EMP-005', name: 'Amara Okafor', department: 'Finance', status: 'active', manager: 'Casey Wong' },
    { id: 'EMP-006', name: 'Noah Patel', department: 'Engineering', status: 'active', manager: 'Avery Brooks' },
    { id: 'EMP-007', name: 'Isabella Rossi', department: 'Sales', status: 'active', manager: 'Morgan Reed' },
    { id: 'EMP-008', name: 'Ethan Davis', department: 'Operations', status: 'active', manager: 'Jordan Ellis' },
    { id: 'EMP-009', name: 'Maya Thompson', department: 'Marketing', status: 'active', manager: 'Taylor Kim' },
    { id: 'EMP-010', name: 'Liam Park', department: 'Finance', status: 'active', manager: 'Casey Wong' },
    { id: 'EMP-011', name: 'Zoe Williams', department: 'Sales', status: 'active', manager: 'Morgan Reed' },
    { id: 'EMP-012', name: 'Daniel Brooks', department: 'Operations', status: 'inactive', manager: 'Jordan Ellis' },
  ];
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const daysAgo = (days: number) => new Date(today - days * 86_400_000).toISOString().slice(0, 10);
  const period = `${now.getFullYear().toString().slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`;
  const purchases = [
    ['Delta Air Lines', 'Travel', 428.6, 'Return flight for the regional client workshop.'],
    ['The Westin', 'Lodging', 219, 'One night for the supplier planning meeting.'],
    ['Figma', 'Software', 144, 'Quarterly design collaboration subscription.'],
    ['Sweetgreen', 'Meals', 32.5, 'Lunch during the offsite project meeting.'],
    ['Amtrak', 'Travel', 128.4, 'Train to the customer implementation session.'],
    ['Staples', 'Office supplies', 86.35, 'Notebook and presentation supplies for the team.'],
    ['Uber', 'Transport', 47.8, 'Airport transfer for a business trip.'],
    ['Notion', 'Software', 96, 'Team knowledge-base subscription renewal.'],
    ['Blue Bottle Coffee', 'Meals', 26.75, 'Working breakfast with the customer success team.'],
    ['United Airlines', 'Travel', 362.9, 'Flight to the operations planning workshop.'],
    ['Marriott', 'Lodging', 189, 'One overnight stay for an approved site visit.'],
    ['Office Depot', 'Office supplies', 114.6, 'Whiteboard and printer supplies for the office.'],
  ] as const;
  const claims: Claim[] = Array.from({ length: 36 }, (_, index) => {
    const employee = employees[index % 11];
    const purchase = purchases[index % purchases.length];
    return {
      id: `CL-${period}-${String(index + 1).padStart(4, '0')}`,
      employeeId: employee.id, employeeName: employee.name, department: employee.department,
      date: daysAgo(3 + Math.floor(index / 3)), submittedDate: daysAgo(1),
      merchant: purchase[0], category: purchase[1], amount: Math.round((purchase[2] + Math.floor(index / 12) * 7.25) * 100) / 100,
      currency: 'USD', receipt: true, description: purchase[3],
    };
  });
  claims[0].amount = 2840;
  claims[0].description = 'International flight for the annual partner summit. Approval needs verification.';
  claims[2].receipt = false;
  claims[4] = { ...claims[4], merchant: 'The Capital Grille', category: 'Meals', amount: 186.4, description: 'Dinner with two prospective clients after the product demo.' };
  claims[7] = { ...claims[7], employeeId: 'EMP-099', employeeName: 'Alex Morgan', department: 'Engineering' };
  claims[10].date = daysAgo(48);
  claims[14] = { ...claims[14], employeeId: employees[11].id, employeeName: employees[11].name, department: employees[11].department };
  claims[15].description = '';
  claims[17] = { ...claims[17], merchant: 'The Hoxton', category: 'Lodging', amount: 385, description: 'Hotel for the quarterly marketing retreat.' };
  claims[20] = { ...claims[9], id: claims[20].id };
  claims[21] = { ...claims[21], merchant: 'Eurostar', category: 'Travel', amount: 162, currency: 'EUR', description: 'Rail travel between the London and Paris offices.' };
  claims[25].receipt = false;
  claims[27].department = 'Finance';
  claims[29] = { ...claims[29], merchant: 'City Parking', category: 'Transport', amount: 42, description: 'Parking for a customer site visit.' };
  claims[30] = { ...claims[29], id: claims[30].id, date: daysAgo(10), description: 'Parking for a second customer site visit.' };
  claims[34] = { ...claims[34], merchant: 'Personal vehicle', category: 'Mileage', amount: 140, mileage: 80, description: 'Round trip to the distribution center.' };
  return { claims, employees };
}
