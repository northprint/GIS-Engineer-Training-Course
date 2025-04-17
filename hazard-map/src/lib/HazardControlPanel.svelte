<script lang="ts">
	import { Toggle, Slider } from 'bits-ui';
	import cn from 'clsx';

	// bindを用いるため、onChange プロパティは不要
	export let hazardControls: { id: string; name: string; visible: boolean; opacity: number }[] = [];
</script>

<div class="space-y-4 rounded bg-white/90 p-4 shadow-md w-72">
	{#each hazardControls as control (control.id)}
		<div class="space-y-2">
			<!-- 1行目: トグルとラベル -->
			<div class="flex flex-col gap-1">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Toggle.Root 
							bind:pressed={control.visible} 
							class="group relative inline-flex h-5 w-10 flex-shrink-0 cursor-pointer items-center rounded-full bg-[var(--color-dark-10)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-foreground)] focus-visible:ring-offset-2 data-[state=on]:bg-[var(--color-foreground)]" 
							aria-label={`${control.name}の表示切替`}
						>
							<span class="pointer-events-none absolute left-[2px] block h-4 w-4 rounded-full bg-white shadow-lg ring-0 transition-transform group-data-[state=on]:translate-x-5"></span>
						</Toggle.Root>
					</div>
					<span class="text-sm text-[var(--color-foreground-alt)]">{Math.round(control.opacity * 100)}%</span>
				</div>
				<span class="text-sm font-medium">{control.name}</span>
			</div>

			<!-- 2行目: スライダー -->
			<div class="w-full">
				<Slider.Root
					type="single"
					bind:value={control.opacity}
					min={0}
					max={1}
					step={0.01}
					class="w-full touch-none select-none"
				>
					<div class="relative flex h-2 w-full items-center">
						<span class="absolute h-2 w-full rounded-full bg-[var(--color-dark-10)]">
							<Slider.Range class="absolute h-full rounded-full bg-[var(--color-foreground)]" />
						</span>
						<Slider.Thumb
							index={0}
							class={cn(
								'absolute block size-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border border-[var(--color-border-input)] bg-[var(--color-background)] shadow-sm transition-colors hover:border-[var(--color-dark-40)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-foreground)] focus-visible:ring-offset-2 active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 dark:bg-[var(--color-foreground)] dark:shadow-[var(--shadow-card)]'
							)}
						/>
					</div>
				</Slider.Root>
			</div>
		</div>
	{/each}
</div>
