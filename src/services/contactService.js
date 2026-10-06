const prisma = require('../config/db');
const { normalizePhoneNumber } = require('./phoneService');
const { logActivity } = require('./activityService');
const { NotFoundError, ConflictError, ValidationError } = require('../utils/errors');

/**
 * List contacts with pagination, search, sorting, and filtering.
 */
async function listContacts({ page = 1, limit = 20, search = '', status = 'active', sortBy = 'name', sortOrder = 'asc' } = {}) {
  const where = {};

  if (status && status !== 'all') {
    where.status = status;
  }

  if (search) {
    where.OR = [
      { name: { contains: search } },
      { phoneNumbers: { some: { originalNumber: { contains: search } } } },
      { phoneNumbers: { some: { normalizedNumber: { contains: search } } } },
    ];
  }

  const orderBy = {};
  const validSortFields = ['name', 'createdAt', 'updatedAt'];
  orderBy[validSortFields.includes(sortBy) ? sortBy : 'name'] = sortOrder === 'desc' ? 'desc' : 'asc';

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      include: {
        phoneNumbers: true,
        tags: { include: { tag: true } },
      },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.contact.count({ where }),
  ]);

  return { contacts, total, page, limit };
}

/**
 * Get a single contact by ID.
 */
async function getContact(id) {
  const contact = await prisma.contact.findUnique({
    where: { id },
    include: {
      phoneNumbers: true,
      tags: { include: { tag: true } },
      importRecords: {
        include: { import: true },
        orderBy: { createdAt: 'desc' },
        take: 10,
      },
    },
  });

  if (!contact) throw new NotFoundError('Contact');
  return contact;
}

/**
 * Create a new contact.
 */
async function createContact({ name, phone, email = null, notes = null, defaultCountry = 'PK' }) {
  if (!name || !name.trim()) throw new ValidationError('Name is required');
  if (!phone || !phone.trim()) throw new ValidationError('Phone number is required');

  const phoneResult = normalizePhoneNumber(phone, defaultCountry);
  if (!phoneResult.isValid) {
    throw new ValidationError(`Invalid phone number: ${phoneResult.error}`);
  }

  // Check if normalized number already exists
  const existing = await prisma.phoneNumber.findUnique({
    where: { normalizedNumber: phoneResult.normalizedNumber },
    include: { contact: true },
  });

  if (existing) {
    throw new ConflictError(
      `Phone number already belongs to contact "${existing.contact.name}"`
    );
  }

  const contact = await prisma.contact.create({
    data: {
      name: name.trim(),
      email: email?.trim() || null,
      notes: notes?.trim() || null,
      phoneNumbers: {
        create: {
          originalNumber: phone.trim(),
          normalizedNumber: phoneResult.normalizedNumber,
          countryCode: phoneResult.countryCode,
          nationalNumber: phoneResult.nationalNumber,
          isPrimary: true,
        },
      },
    },
    include: {
      phoneNumbers: true,
    },
  });

  await logActivity('contact_created', 'contact', contact.id, {
    name: contact.name,
    phone: phoneResult.normalizedNumber,
  });

  return contact;
}

/**
 * Update an existing contact.
 */
async function updateContact(id, { name, email, notes, status }) {
  const existing = await prisma.contact.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Contact');

  const data = {};
  if (name !== undefined) data.name = name.trim();
  if (email !== undefined) data.email = email?.trim() || null;
  if (notes !== undefined) data.notes = notes?.trim() || null;
  if (status !== undefined) data.status = status;

  const contact = await prisma.contact.update({
    where: { id },
    data,
    include: {
      phoneNumbers: true,
      tags: { include: { tag: true } },
    },
  });

  await logActivity('contact_updated', 'contact', contact.id, {
    name: contact.name,
    changes: Object.keys(data),
  });

  return contact;
}

/**
 * Soft delete a contact.
 */
async function deleteContact(id) {
  const existing = await prisma.contact.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError('Contact');

  const contact = await prisma.contact.update({
    where: { id },
    data: { status: 'deleted' },
  });

  await logActivity('contact_deleted', 'contact', id, { name: existing.name });
  return contact;
}

/**
 * Search contacts by name or phone.
 */
async function searchContacts(query, { page = 1, limit = 20 } = {}) {
  if (!query || !query.trim()) {
    return { contacts: [], total: 0, page, limit };
  }

  const where = {
    status: { not: 'deleted' },
    OR: [
      { name: { contains: query } },
      { phoneNumbers: { some: { originalNumber: { contains: query } } } },
      { phoneNumbers: { some: { normalizedNumber: { contains: query } } } },
    ],
  };

  const [contacts, total] = await Promise.all([
    prisma.contact.findMany({
      where,
      include: {
        phoneNumbers: true,
        tags: { include: { tag: true } },
      },
      orderBy: { name: 'asc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.contact.count({ where }),
  ]);

  return { contacts, total, page, limit };
}

/**
 * Get duplicate phone numbers (contacts sharing normalized numbers).
 */
async function getDuplicates() {
  const phoneNumbers = await prisma.phoneNumber.findMany({
    include: { contact: true },
    orderBy: { normalizedNumber: 'asc' },
  });

  // Group by normalized number
  const groups = {};
  for (const pn of phoneNumbers) {
    if (!groups[pn.normalizedNumber]) {
      groups[pn.normalizedNumber] = [];
    }
    groups[pn.normalizedNumber].push({
      phoneId: pn.id,
      originalNumber: pn.originalNumber,
      contact: {
        id: pn.contact.id,
        name: pn.contact.name,
        status: pn.contact.status,
      },
    });
  }

  // Only return groups with more than one entry
  const duplicates = Object.entries(groups)
    .filter(([, entries]) => entries.length > 1)
    .map(([normalizedNumber, entries]) => ({
      normalizedNumber,
      count: entries.length,
      entries,
    }));

  return duplicates;
}

/**
 * Get conflicts with optional status filter.
 */
async function getConflicts({ resolution = null, page = 1, limit = 20 } = {}) {
  const where = {};
  if (resolution) where.resolution = resolution;

  const [conflicts, total] = await Promise.all([
    prisma.conflict.findMany({
      where,
      include: { import: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.conflict.count({ where }),
  ]);

  return { conflicts, total, page, limit };
}

/**
 * Resolve a conflict.
 */
async function resolveConflict(conflictId, resolution) {
  const conflict = await prisma.conflict.findUnique({ where: { id: conflictId } });
  if (!conflict) throw new NotFoundError('Conflict');

  const validResolutions = ['keep_existing', 'use_incoming', 'reviewed'];
  if (!validResolutions.includes(resolution)) {
    throw new ValidationError(`Invalid resolution. Must be one of: ${validResolutions.join(', ')}`);
  }

  if (resolution === 'use_incoming') {
    // Update existing contact name or create new contact
    if (conflict.existingContactId) {
      await prisma.contact.update({
        where: { id: conflict.existingContactId },
        data: { name: conflict.incomingName },
      });
      await logActivity('contact_updated', 'contact', conflict.existingContactId, {
        previousName: conflict.existingName,
        newName: conflict.incomingName,
        source: 'conflict_resolution',
      });
    }
  }

  const updated = await prisma.conflict.update({
    where: { id: conflictId },
    data: {
      resolution,
      resolvedAt: new Date(),
    },
  });

  await logActivity('conflict_resolved', 'conflict', conflictId, {
    resolution,
    existingName: conflict.existingName,
    incomingName: conflict.incomingName,
  });

  return updated;
}

module.exports = {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
  searchContacts,
  getDuplicates,
  getConflicts,
  resolveConflict,
};
