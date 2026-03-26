import mongoose from 'mongoose';
import dotenv from 'dotenv';
import UserModel from '../src/models/User';
import ExpenseModel from '../src/models/Expense';

dotenv.config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/money-flow';

const seed = async () => {
  await mongoose.connect(MONGODB_URI);
  console.log('Connected to MongoDB');

  // Clear existing data
  await UserModel.deleteMany({});
  await ExpenseModel.deleteMany({});
  console.log('Cleared existing data');

  // Create test user (password: "password123")
  const user = await UserModel.create({
    email: 'test@example.com',
    password: 'password123',
    budgets: [
      { category: 'Food', limit: 5000, alert_threshold: 0.9, enable_alerts: true },
      { category: 'Transport', limit: 2000, alert_threshold: 0.8, enable_alerts: false },
    ],
  });
  console.log(`Created user: ${user.email} (id: ${user._id})`);

  // Create sample expenses
  const now = new Date();
  const expenses = [
    { owner: user._id, description: 'Lunch at Tim Ho Wan', amount: 85, type: 'expense', category: 'Food', date: new Date(now.getFullYear(), now.getMonth(), 1) },
    { owner: user._id, description: 'MTR monthly pass', amount: 500, type: 'expense', category: 'Transport', date: new Date(now.getFullYear(), now.getMonth(), 2) },
    { owner: user._id, description: 'Groceries at Wellcome', amount: 320, type: 'expense', category: 'Food', date: new Date(now.getFullYear(), now.getMonth(), 5) },
    { owner: user._id, description: 'Salary', amount: 35000, type: 'income', category: 'Salary', date: new Date(now.getFullYear(), now.getMonth(), 1) },
    { owner: user._id, description: 'Electricity bill', amount: 450, type: 'expense', category: 'Utilities', date: new Date(now.getFullYear(), now.getMonth(), 10) },
    { owner: user._id, description: 'Netflix subscription', amount: 78, type: 'expense', category: 'Entertainment', date: new Date(now.getFullYear(), now.getMonth(), 15) },
    { owner: user._id, description: 'Coffee at Starbucks', amount: 42, type: 'expense', category: 'Food', date: new Date(now.getFullYear(), now.getMonth(), 18) },
    { owner: user._id, description: 'Freelance payment', amount: 5000, type: 'income', category: 'Freelance', date: new Date(now.getFullYear(), now.getMonth(), 20) },
  ];

  await ExpenseModel.insertMany(expenses);
  console.log(`Created ${expenses.length} sample transactions`);

  console.log('\nSeed complete! Login with:');
  console.log('  Email: test@example.com');
  console.log('  Password: password123');

  await mongoose.disconnect();
};

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
