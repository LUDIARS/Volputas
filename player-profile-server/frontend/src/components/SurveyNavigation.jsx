import { NavLink, Link, useSearchParams } from 'react-router-dom';
import { groupSurveysByCategory } from '../lib/surveyCategories';

export default function SurveyNavigation({ surveys, loading = false }) {
  const [searchParams] = useSearchParams();
  const activeSurveyId = searchParams.get('survey');
  const groups = groupSurveysByCategory(surveys);

  return (
    <div className="survey-nav">
      <NavLink to="/surveys">
        <span className="nav-icon">&#9998;</span>
        <span>Surveys</span>
      </NavLink>

      <div className="survey-nav-tree">
        {loading && <div className="survey-nav-empty">Loading...</div>}
        {!loading && groups.length === 0 && (
          <div className="survey-nav-empty">No surveys</div>
        )}
        {groups.map((group) => (
          <div className="survey-nav-category" key={group.id}>
            <div className="survey-nav-category-header">
              <span>{group.label}</span>
              <span>{group.answeredCount}/{group.surveys.length}</span>
            </div>
            {group.surveys.map((survey) => (
              <Link
                key={survey.id}
                to={`/surveys?survey=${encodeURIComponent(survey.id)}`}
                className={`survey-nav-item ${activeSurveyId === survey.id ? 'active' : ''}`}
              >
                <span className={`survey-status-dot ${survey.responseStatus}`} />
                <span className="survey-nav-title">{survey.title}</span>
              </Link>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
