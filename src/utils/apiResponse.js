function success(res, data = null, statusCode = 200) {
  const response = { success: true };
  if (data !== null) response.data = data;
  return res.status(statusCode).json(response);
}

function error(res, message = 'Internal server error', statusCode = 500, details = null) {
  const response = {
    success: false,
    error: { message, code: statusCode },
  };
  if (details) response.error.details = details;
  return res.status(statusCode).json(response);
}

function paginated(res, data, total, page, limit) {
  const paginationObj = {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasMore: page * limit < total,
  };
  return res.status(200).json({
    success: true,
    data,
    pagination: paginationObj,
    meta: paginationObj,
  });
}

module.exports = { success, error, paginated };
