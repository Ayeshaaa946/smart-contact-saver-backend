const prisma = require('../src/config/db');
const { normalizePhoneNumber } = require('../src/services/phoneService');

async function seedDatabase() {
  console.log('Seeding MongoDB database...');

  // Safely clean existing data if collections exist
  const safeDelete = async (model) => {
    try {
      await model.deleteMany();
    } catch (e) {
      // Collection might not exist yet in MongoDB
    }
  };

  await safeDelete(prisma.activityLog);
  await safeDelete(prisma.conflict);
  await safeDelete(prisma.importRecord);
  await safeDelete(prisma.import);
  await safeDelete(prisma.contactTag);
  await safeDelete(prisma.tag);
  await safeDelete(prisma.phoneNumber);
  await safeDelete(prisma.contact);

  // Create Tags
  const workTag = await prisma.tag.create({ data: { name: 'Work', color: '#075E54' } });
  const clientTag = await prisma.tag.create({ data: { name: 'Client', color: '#25D366' } });
  const personalTag = await prisma.tag.create({ data: { name: 'Personal', color: '#8b5cf6' } });
  const vipTag = await prisma.tag.create({ data: { name: 'VIP', color: '#f59e0b' } });

  // Sample Contacts
  const sampleContacts = [
    { name: 'Muhammad Ali', phone: '03001234567', email: 'ali@example.com', notes: 'Primary contact for tech support', tagIds: [workTag.id, vipTag.id] },
    { name: 'Fatima Zahra', phone: '+92 312 9876543', email: 'fatima@company.pk', notes: 'Marketing lead', tagIds: [clientTag.id] },
    { name: 'Usman Ghani', phone: '923334567890', email: 'usman@gmail.com', notes: 'Software Vendor', tagIds: [workTag.id] },
    { name: 'Ayesha Khan', phone: '0345-1122334', email: 'ayesha@domain.com', notes: 'Design consultant', tagIds: [personalTag.id] },
    { name: 'Zainab Bibi', phone: '(0300) 5556677', email: 'zainab@enterprise.org', notes: 'HR Director', tagIds: [workTag.id, clientTag.id] },
    { name: 'Bilal Ahmed', phone: '+92-321-4433221', email: 'bilal@fintech.io', notes: 'Finance advisor', tagIds: [vipTag.id] },
  ];

  for (const c of sampleContacts) {
    const norm = normalizePhoneNumber(c.phone, 'PK');
    const contact = await prisma.contact.create({
      data: {
        name: c.name,
        email: c.email,
        notes: c.notes,
        phoneNumbers: {
          create: {
            originalNumber: c.phone,
            normalizedNumber: norm.normalizedNumber || c.phone,
            countryCode: norm.countryCode || 'PK',
            nationalNumber: norm.nationalNumber || '',
            isPrimary: true,
          },
        },
        tags: {
          create: c.tagIds.map((tagId) => ({ tagId })),
        },
      },
    });

    await prisma.activityLog.create({
      data: {
        action: 'contact_created',
        entityType: 'contact',
        entityId: contact.id,
        details: JSON.stringify({ name: contact.name, phone: norm.normalizedNumber }),
      },
    });
  }

  // Create an initial sample import record and pending conflict for UI demonstration
  const sampleImport = await prisma.import.create({
    data: {
      fileName: 'sample_contacts_import.xlsx',
      originalName: 'Sample_Contacts_2026.xlsx',
      totalRows: 10,
      newContacts: 6,
      existingContacts: 2,
      duplicates: 1,
      invalidNumbers: 0,
      conflicts: 1,
      status: 'completed',
      columnMapping: JSON.stringify({ nameColumn: 0, phoneColumn: 1 }),
      completedAt: new Date(),
    },
  });

  const aliContact = await prisma.contact.findFirst({ where: { name: 'Muhammad Ali' } });

  await prisma.conflict.create({
    data: {
      importId: sampleImport.id,
      existingContactId: aliContact?.id,
      existingName: 'Muhammad Ali',
      existingPhone: '+923001234567',
      incomingName: 'M. Ali CEO',
      incomingPhone: '0300-1234567',
      normalizedPhone: '+923001234567',
      resolution: 'pending',
    },
  });

  await prisma.activityLog.create({
    data: {
      action: 'import_completed',
      entityType: 'import',
      entityId: sampleImport.id,
      details: JSON.stringify({ fileName: 'Sample_Contacts_2026.xlsx', totalRows: 10 }),
    },
  });

  console.log('MongoDB database seeded successfully!');
}

if (require.main === module) {
  seedDatabase()
    .then(async () => {
      await prisma.$disconnect();
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Seeding failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}

module.exports = { seedDatabase };
