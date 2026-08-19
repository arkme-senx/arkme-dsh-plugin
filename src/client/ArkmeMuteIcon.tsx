export function ArkmeMuteIcon({ size = 18 }: { size?: number }) {
  return <svg
    role="img"
    aria-label="消息免打扰已开启"
    width={size}
    height={size}
    viewBox="0 0 20 20"
    fill="none"
    style={{ display: 'block', flex: 'none' }}
  >
    <path
      d="M10.0175 2.42578C7.25914 2.42578 5.01747 4.66745 5.01747 7.42578V9.83412C5.01747 10.3424 4.80081 11.1174 4.54247 11.5508L3.58414 13.1424C2.99247 14.1258 3.40081 15.2174 4.48414 15.5841C8.07581 16.7841 11.9508 16.7841 15.5425 15.5841C16.5508 15.2508 16.9925 14.0591 16.4425 13.1424L15.4841 11.5508C15.2341 11.1174 15.0175 10.3424 15.0175 9.83412V7.42578C15.0175 4.67578 12.7675 2.42578 10.0175 2.42578Z"
      stroke="currentColor" strokeWidth="1.4" strokeMiterlimit="10" strokeLinecap="round"
    />
    <path
      d="M11.5599 2.66719C11.3016 2.59219 11.0349 2.53385 10.7599 2.50052C9.9599 2.40052 9.19323 2.45885 8.47656 2.66719C8.71823 2.05052 9.31823 1.61719 10.0182 1.61719C10.7182 1.61719 11.3182 2.05052 11.5599 2.66719Z"
      stroke="currentColor" strokeWidth="1.25" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round"
    />
    <path
      d="M12.5156 15.8828C12.5156 17.2578 11.3906 18.3828 10.0156 18.3828C9.33229 18.3828 8.69896 18.0995 8.24896 17.6495C7.79896 17.1995 7.51562 16.5661 7.51562 15.8828"
      stroke="currentColor" strokeWidth="1.25" strokeMiterlimit="10"
    />
    <path d="M17 4.04297L2.91797 18.125" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
}
