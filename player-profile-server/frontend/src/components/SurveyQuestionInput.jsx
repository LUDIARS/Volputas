export default function SurveyQuestionInput({ question, value, onChange }) {
  if (question.type === 'choice') {
    return (
      <div className="choice-options">
        {question.options.map((option) => {
          const optionValue = typeof option === 'object' ? option.value : option;
          const optionLabel = typeof option === 'object' ? option.label : option;
          return (
            <label
              key={optionValue}
              className={`choice-option ${value === optionValue ? 'selected' : ''}`}
            >
              <input
                type="radio"
                name={question.id}
                value={optionValue}
                checked={value === optionValue}
                onChange={() => onChange(optionValue)}
              />
              {optionLabel}
            </label>
          );
        })}
      </div>
    );
  }

  if (question.type === 'scale') {
    const minimum = question.options?.min ?? 1;
    const maximum = question.options?.max ?? 5;
    const values = Array.from(
      { length: maximum - minimum + 1 },
      (_, index) => minimum + index
    );
    return (
      <div className="scale-options">
        {values.map((scaleValue) => (
          <label
            key={scaleValue}
            className={`scale-option ${value === scaleValue ? 'selected' : ''}`}
          >
            <input
              type="radio"
              name={question.id}
              value={scaleValue}
              checked={value === scaleValue}
              onChange={() => onChange(scaleValue)}
            />
            {scaleValue}
          </label>
        ))}
        {value === undefined && <span className="scale-unanswered">未回答</span>}
      </div>
    );
  }

  return (
    <textarea
      value={value || ''}
      onChange={(event) => onChange(event.target.value)}
      rows={3}
      placeholder="回答を入力してください"
    />
  );
}
