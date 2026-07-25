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
    return (
      <div className="scale-input">
        <span className="scale-label">{minimum}</span>
        <input
          type="range"
          min={minimum}
          max={maximum}
          value={value ?? minimum}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="scale-label">{maximum}</span>
        <span className="scale-value">{value ?? minimum}</span>
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
