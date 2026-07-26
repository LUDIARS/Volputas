async function listSurveysWithResponseStatus({
  surveys,
  responseStore,
  repositoryRoot,
  name,
}) {
  return Promise.all(
    surveys.map(async (survey) => {
      const response = await responseStore.read({
        repositoryRoot,
        name,
        surveyId: survey.id,
      });
      return {
        ...survey,
        responseStatus: response ? 'answered' : 'unanswered',
        responseUpdatedAt: response?.updatedAt ?? null,
      };
    })
  );
}

module.exports = { listSurveysWithResponseStatus };
